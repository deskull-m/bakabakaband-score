'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');
const Database = require('better-sqlite3');
const { contentHash } = require('./canonical');
const { suspicionOf } = require('./plausibility');

const ATTACHMENT_KINDS = ['character_dump', 'screen_dump'];

/*!
 * スキーマのマイグレーション。PRAGMA user_version を適用済みの番号として使う。
 * 既存 DB には未適用の分だけ順に適用する。各要素は 1 トランザクションで実行される。
 */
const MIGRATIONS = [
    // 1: 初期スキーマ
    `
    CREATE TABLE IF NOT EXISTS scores (
        id              TEXT PRIMARY KEY,
        created_at      TEXT NOT NULL,
        name            TEXT NOT NULL,
        race            TEXT,
        class           TEXT,
        sex             TEXT,
        personality     TEXT,
        level           INTEGER NOT NULL,
        max_level       INTEGER NOT NULL,
        depth           INTEGER,
        max_depth       INTEGER,
        gold            INTEGER,
        turns           INTEGER,
        play_time_sec   INTEGER,
        points_claimed  INTEGER NOT NULL,
        points_computed INTEGER,
        points          INTEGER NOT NULL,
        death_cause     TEXT,
        is_winner       INTEGER NOT NULL DEFAULT 0,
        game_version    TEXT,
        platform        TEXT,
        verified        INTEGER NOT NULL DEFAULT 0,
        flags           TEXT NOT NULL DEFAULT '[]',
        submission      TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS scores_points_idx ON scores (points DESC, created_at ASC);
    `,
    // 2: 重複送信の抑止 (#9)
    `
    ALTER TABLE scores ADD COLUMN submission_id TEXT;
    ALTER TABLE scores ADD COLUMN content_hash TEXT;
    CREATE UNIQUE INDEX IF NOT EXISTS scores_submission_id_idx ON scores (submission_id) WHERE submission_id IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS scores_content_hash_idx ON scores (content_hash);
    `,
    // 3: 日次受付上限の集計用 (#15)
    `
    CREATE INDEX IF NOT EXISTS scores_created_at_idx ON scores (created_at);
    `,
    // 4: 添付 (キャラクターダンプ・スクリーンショット) を分離して gzip 保存 (#12)
    `
    CREATE TABLE IF NOT EXISTS attachments (
        score_id    TEXT NOT NULL REFERENCES scores(id) ON DELETE CASCADE,
        kind        TEXT NOT NULL,
        size        INTEGER NOT NULL,
        body_gz     BLOB NOT NULL,
        PRIMARY KEY (score_id, kind)
    );
    `,
    // 5: 論理削除と管理操作の監査ログ (#10)
    `
    ALTER TABLE scores ADD COLUMN deleted_at TEXT;
    CREATE INDEX IF NOT EXISTS scores_live_points_idx ON scores (points DESC, created_at ASC) WHERE deleted_at IS NULL;
    CREATE TABLE IF NOT EXISTS admin_log (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        at          TEXT NOT NULL,
        action      TEXT NOT NULL,
        score_id    TEXT,
        detail      TEXT
    );
    `,
    // 6: 絞り込み用インデックス (#11)
    `
    CREATE INDEX IF NOT EXISTS scores_race_idx ON scores (race) WHERE deleted_at IS NULL;
    CREATE INDEX IF NOT EXISTS scores_class_idx ON scores (class) WHERE deleted_at IS NULL;
    CREATE INDEX IF NOT EXISTS scores_winner_idx ON scores (is_winner) WHERE deleted_at IS NULL;
    CREATE INDEX IF NOT EXISTS scores_version_idx ON scores (game_version) WHERE deleted_at IS NULL;
    CREATE INDEX IF NOT EXISTS scores_death_cause_idx ON scores (death_cause) WHERE deleted_at IS NULL;
    `,
    // 7: フラグの重み付け合計 (#8)
    `
    ALTER TABLE scores ADD COLUMN suspicion INTEGER NOT NULL DEFAULT 0;
    `,
];

/*!
 * スキーマ変更に伴うデータ移行。キーはマイグレーション番号 (適用後の user_version)。
 */
const DATA_MIGRATIONS = {
    // 既存の flags から suspicion を計算する
    7(db) {
        const update = db.prepare('UPDATE scores SET suspicion = ? WHERE id = ?');
        for (const row of db.prepare('SELECT id, flags FROM scores').all()) {
            update.run(suspicionOf(JSON.parse(row.flags)), row.id);
        }
    },
    // scores.submission に埋め込まれていた添付を attachments テーブルへ移す
    4(db) {
        const rows = db.prepare('SELECT id, submission FROM scores').all();
        const update = db.prepare('UPDATE scores SET submission = ? WHERE id = ?');
        const insert = db.prepare('INSERT OR REPLACE INTO attachments (score_id, kind, size, body_gz) VALUES (?, ?, ?, ?)');
        for (const row of rows) {
            const submission = JSON.parse(row.submission);
            if (!submission.attachments) {
                continue;
            }
            for (const [kind, body] of Object.entries(submission.attachments)) {
                if (typeof body === 'string' && body.length > 0) {
                    insert.run(row.id, kind, Buffer.byteLength(body, 'utf8'), zlib.gzipSync(body));
                }
            }
            delete submission.attachments;
            update.run(JSON.stringify(submission), row.id);
        }
    },
};

const SUMMARY_COLUMNS = `
    id, created_at, name, race, class, sex, personality, level, max_level,
    depth, max_depth, gold, turns, play_time_sec, points, points_claimed,
    points_computed, death_cause, is_winner, game_version, platform, verified, flags,
    submission_id, deleted_at, suspicion
`;
const LIVE = 'deleted_at IS NULL';

function rowToSummary(row) {
    if (!row) {
        return null;
    }
    return Object.assign({}, row, {
        is_winner: Boolean(row.is_winner),
        verified: Boolean(row.verified),
        flags: JSON.parse(row.flags),
    });
}

class ScoreStore {
    /*!
     * @param dbPath SQLite ファイル。':memory:' でインメモリ
     * @param opts.suspicionHideThreshold 未検証でこの点数以上の記録を既定表示から外す (0 で無効)
     */
    constructor(dbPath, opts = {}) {
        this.hideThreshold = opts.suspicionHideThreshold || 0;
        if (dbPath !== ':memory:') {
            fs.mkdirSync(path.dirname(dbPath), { recursive: true });
        }
        this.db = new Database(dbPath);
        this.db.pragma('journal_mode = WAL');
        this.db.pragma('foreign_keys = ON');
        this.migrate();

        this.insertStmt = this.db.prepare(`
            INSERT INTO scores (
                id, created_at, name, race, class, sex, personality, level, max_level,
                depth, max_depth, gold, turns, play_time_sec, points_claimed, points_computed,
                points, death_cause, is_winner, game_version, platform, verified, flags, submission,
                submission_id, content_hash, suspicion
            ) VALUES (
                @id, @created_at, @name, @race, @class, @sex, @personality, @level, @max_level,
                @depth, @max_depth, @gold, @turns, @play_time_sec, @points_claimed, @points_computed,
                @points, @death_cause, @is_winner, @game_version, @platform, @verified, @flags, @submission,
                @submission_id, @content_hash, @suspicion
            )`);
        // 重複判定は削除済みの記録も含める (管理者が消した記録の再送を通さない)
        this.findDuplicateStmt = this.db.prepare(
            'SELECT id, points, created_at, deleted_at FROM scores WHERE (submission_id IS NOT NULL AND submission_id = ?) OR content_hash = ? LIMIT 1');
        this.rankStmt = this.db.prepare(
            `SELECT COUNT(*) + 1 AS rank FROM scores WHERE ${LIVE} AND ${this.visibleClause()} AND (points > ? OR (points = ? AND created_at < ?))`);
        // 日次上限は削除済みも数える (削除で枠が空かないように)
        this.countSinceStmt = this.db.prepare('SELECT COUNT(*) AS n FROM scores WHERE created_at >= ?');
        this.getStmt = this.db.prepare(`SELECT ${SUMMARY_COLUMNS}, submission FROM scores WHERE id = ?`);
        this.softDeleteStmt = this.db.prepare(`UPDATE scores SET deleted_at = ? WHERE id = ? AND ${LIVE}`);
        this.restoreStmt = this.db.prepare('UPDATE scores SET deleted_at = NULL WHERE id = ? AND deleted_at IS NOT NULL');
        this.purgeStmt = this.db.prepare('DELETE FROM scores WHERE id = ?');
        this.verifyStmt = this.db.prepare(`UPDATE scores SET verified = ? WHERE id = ? AND ${LIVE}`);
        this.logStmt = this.db.prepare('INSERT INTO admin_log (at, action, score_id, detail) VALUES (?, ?, ?, ?)');
        this.listLogStmt = this.db.prepare('SELECT id, at, action, score_id, detail FROM admin_log ORDER BY id DESC LIMIT ? OFFSET ?');
        this.insertAttachmentStmt = this.db.prepare(
            'INSERT INTO attachments (score_id, kind, size, body_gz) VALUES (?, ?, ?, ?)');
        this.listAttachmentsStmt = this.db.prepare('SELECT kind, size FROM attachments WHERE score_id = ?');
        this.getAttachmentStmt = this.db.prepare(
            `SELECT a.size, a.body_gz FROM attachments a JOIN scores s ON s.id = a.score_id WHERE s.${LIVE} AND a.score_id = ? AND a.kind = ?`);
    }

    migrate() {
        const current = this.db.pragma('user_version', { simple: true });
        for (let v = current; v < MIGRATIONS.length; v++) {
            this.db.transaction(() => {
                this.db.exec(MIGRATIONS[v]);
                if (DATA_MIGRATIONS[v + 1]) {
                    DATA_MIGRATIONS[v + 1](this.db);
                }
                this.db.pragma(`user_version = ${v + 1}`);
            })();
        }
    }

    /*!
     * 検証済み envelope を 1 件登録する。
     * submission_id または内容ハッシュが既存の記録と一致する場合は登録せず、既存の記録を返す。
     * @returns {{ id: string, rank: number, duplicate: boolean }}
     */
    /*!
     * 既定表示に含める記録の条件。検証済みは常に含める。
     */
    visibleClause() {
        return this.hideThreshold > 0 ? `(verified = 1 OR suspicion < ${this.hideThreshold})` : '1';
    }

    insert(submission, { flags, pointsComputed, suspicion }) {
        const c = submission.character;
        const basic = c.basic || {};
        const status = c.status || {};
        const death = c.death || {};
        const progress = submission.progress;
        const game = submission.game || {};

        const points = pointsComputed !== null ? pointsComputed : submission.score.points;
        const { attachments, ...stored } = submission;
        const row = {
            id: crypto.randomUUID(),
            created_at: new Date().toISOString(),
            name: basic.name,
            race: basic.race || null,
            class: basic.class || null,
            sex: basic.sex || null,
            personality: basic.personality || null,
            level: basic.level,
            max_level: progress.max_level,
            depth: status.dungeon_level ?? null,
            max_depth: progress.max_depth_overall ?? status.max_dungeon_level ?? null,
            gold: status.gold ?? null,
            turns: progress.real_turns,
            play_time_sec: progress.play_time_sec ?? null,
            points_claimed: submission.score.points,
            points_computed: pointsComputed,
            points,
            death_cause: death.cause || null,
            is_winner: progress.true_winner || progress.total_winner || death.is_winner ? 1 : 0,
            game_version: game.version || null,
            platform: game.platform || null,
            verified: 0,
            flags: JSON.stringify(flags),
            suspicion: suspicion ?? suspicionOf(flags),
            submission: JSON.stringify(stored),
            submission_id: submission.submission_id || null,
            content_hash: contentHash(submission),
        };

        const tx = this.db.transaction(() => {
            const existing = this.findDuplicateStmt.get(row.submission_id, row.content_hash);
            if (existing) {
                const rank = existing.deleted_at
                    ? null
                    : this.rankStmt.get(existing.points, existing.points, existing.created_at).rank;
                return { id: existing.id, rank, duplicate: true };
            }
            this.insertStmt.run(row);
            for (const kind of ATTACHMENT_KINDS) {
                const body = attachments && attachments[kind];
                if (typeof body === 'string' && body.length > 0) {
                    this.insertAttachmentStmt.run(row.id, kind, Buffer.byteLength(body, 'utf8'), zlib.gzipSync(body));
                }
            }
            const rank = this.rankStmt.get(points, points, row.created_at).rank;
            return { id: row.id, rank, duplicate: false };
        });
        return tx();
    }

    /*!
     * 絞り込み条件から WHERE 句とパラメータを組み立てる。
     * @param {Object} f  { flagged, race, class, winner, version, since, until, name }
     */
    buildFilter(f = {}) {
        const where = [LIVE];
        const params = [];
        if (f.flagged) {
            where.push('verified = 0 AND flags != \'[]\'');
        } else if (!f.includeFlagged) {
            where.push(this.visibleClause());
        }
        if (f.race) {
            where.push('race = ?');
            params.push(f.race);
        }
        if (f.class) {
            where.push('class = ?');
            params.push(f.class);
        }
        if (f.winner) {
            where.push('is_winner = 1');
        }
        if (f.version) {
            where.push('game_version = ?');
            params.push(f.version);
        }
        if (f.since) {
            where.push('created_at >= ?');
            params.push(f.since);
        }
        if (f.until) {
            where.push('created_at < ?');
            params.push(f.until);
        }
        if (f.name) {
            where.push('name LIKE ? ESCAPE \'\\\'');
            params.push('%' + f.name.replace(/[\\%_]/g, (c) => '\\' + c) + '%');
        }
        return { where: where.join(' AND '), params };
    }

    /*!
     * @param {Object} opts { limit, offset, sort: 'points'|'recent', ...絞り込み }
     */
    list({ limit, offset, sort = 'points', ...filter }) {
        const { where, params } = this.buildFilter(filter);
        const order = sort === 'recent' ? 'created_at DESC' : 'points DESC, created_at ASC';
        return this.db.prepare(`SELECT ${SUMMARY_COLUMNS} FROM scores WHERE ${where} ORDER BY ${order} LIMIT ? OFFSET ?`)
            .all(...params, limit, offset).map(rowToSummary);
    }

    count(filter = {}) {
        const { where, params } = this.buildFilter(filter);
        return this.db.prepare(`SELECT COUNT(*) AS n FROM scores WHERE ${where}`).get(...params).n;
    }

    /*!
     * 集計。種族・職業ごとの件数と最高記録、死因の上位、バージョン一覧。
     */
    stats() {
        const best = (column) => this.db.prepare(`
            SELECT ${column} AS key, COUNT(*) AS count, SUM(is_winner) AS winners, MAX(points) AS best_points,
                   (SELECT id FROM scores s2 WHERE s2.${LIVE} AND s2.${column} = s1.${column} ORDER BY points DESC, created_at ASC LIMIT 1) AS best_id,
                   (SELECT name FROM scores s2 WHERE s2.${LIVE} AND s2.${column} = s1.${column} ORDER BY points DESC, created_at ASC LIMIT 1) AS best_name
            FROM scores s1 WHERE ${LIVE} AND ${column} IS NOT NULL GROUP BY ${column} ORDER BY count DESC, key ASC`).all();
        const totals = this.db.prepare(`SELECT COUNT(*) AS total, COALESCE(SUM(is_winner), 0) AS winners,
            COALESCE(SUM(verified), 0) AS verified, MIN(created_at) AS first, MAX(created_at) AS last FROM scores WHERE ${LIVE}`).get();
        const deaths = this.db.prepare(`SELECT death_cause AS cause, COUNT(*) AS count FROM scores
            WHERE ${LIVE} AND is_winner = 0 AND death_cause IS NOT NULL GROUP BY death_cause ORDER BY count DESC, cause ASC LIMIT 20`).all();
        const versions = this.db.prepare(`SELECT game_version AS version, COUNT(*) AS count FROM scores
            WHERE ${LIVE} AND game_version IS NOT NULL GROUP BY game_version ORDER BY count DESC, version ASC`).all();
        return { totals, by_race: best('race'), by_class: best('class'), by_death_cause: deaths, by_version: versions };
    }

    countSince(isoTimestamp) {
        return this.countSinceStmt.get(isoTimestamp).n;
    }

    /*!
     * @param id 記録 ID
     * @param includeDeleted 論理削除済みも返す (管理用)
     */
    get(id, { includeDeleted = false } = {}) {
        const row = this.getStmt.get(id);
        if (!row || (row.deleted_at && !includeDeleted)) {
            return null;
        }
        const summary = rowToSummary(row);
        summary.submission = JSON.parse(row.submission);
        summary.attachments = {};
        for (const a of this.listAttachmentsStmt.all(id)) {
            summary.attachments[a.kind] = { size: a.size };
        }
        return summary;
    }

    /*!
     * 添付を展開して返す。無ければ null。
     * @returns {{ size: number, body: string } | null}
     */
    getAttachment(id, kind) {
        if (!ATTACHMENT_KINDS.includes(kind)) {
            return null;
        }
        const row = this.getAttachmentStmt.get(id, kind);
        if (!row) {
            return null;
        }
        return { size: row.size, body: zlib.gunzipSync(row.body_gz).toString('utf8') };
    }

    /*!
     * 論理削除。公開 API からは見えなくなるが行と添付は残り、restore で戻せる。
     */
    delete(id, detail = null) {
        const ok = this.softDeleteStmt.run(new Date().toISOString(), id).changes > 0;
        if (ok) {
            this.log('delete', id, detail);
        }
        return ok;
    }

    restore(id, detail = null) {
        const ok = this.restoreStmt.run(id).changes > 0;
        if (ok) {
            this.log('restore', id, detail);
        }
        return ok;
    }

    /*!
     * 物理削除。添付も外部キーで消える。重複判定からも外れるので再送が通るようになる。
     */
    purge(id, detail = null) {
        const ok = this.purgeStmt.run(id).changes > 0;
        if (ok) {
            this.log('purge', id, detail);
        }
        return ok;
    }

    setVerified(id, verified, detail = null) {
        const ok = this.verifyStmt.run(verified ? 1 : 0, id).changes > 0;
        if (ok) {
            this.log(verified ? 'verify' : 'unverify', id, detail);
        }
        return ok;
    }

    log(action, scoreId, detail) {
        this.logStmt.run(new Date().toISOString(), action, scoreId, detail || null);
    }

    listLog({ limit, offset }) {
        return this.listLogStmt.all(limit, offset);
    }

    close() {
        this.db.close();
    }
}

module.exports = { ScoreStore, MIGRATIONS, ATTACHMENT_KINDS };
