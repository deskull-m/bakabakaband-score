'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');
const { contentHash } = require('./canonical');

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
];

const SUMMARY_COLUMNS = `
    id, created_at, name, race, class, sex, personality, level, max_level,
    depth, max_depth, gold, turns, play_time_sec, points, points_claimed,
    points_computed, death_cause, is_winner, game_version, platform, verified, flags,
    submission_id
`;

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
    constructor(dbPath) {
        if (dbPath !== ':memory:') {
            fs.mkdirSync(path.dirname(dbPath), { recursive: true });
        }
        this.db = new Database(dbPath);
        this.db.pragma('journal_mode = WAL');
        this.migrate();

        this.insertStmt = this.db.prepare(`
            INSERT INTO scores (
                id, created_at, name, race, class, sex, personality, level, max_level,
                depth, max_depth, gold, turns, play_time_sec, points_claimed, points_computed,
                points, death_cause, is_winner, game_version, platform, verified, flags, submission,
                submission_id, content_hash
            ) VALUES (
                @id, @created_at, @name, @race, @class, @sex, @personality, @level, @max_level,
                @depth, @max_depth, @gold, @turns, @play_time_sec, @points_claimed, @points_computed,
                @points, @death_cause, @is_winner, @game_version, @platform, @verified, @flags, @submission,
                @submission_id, @content_hash
            )`);
        this.findDuplicateStmt = this.db.prepare(
            'SELECT id, points, created_at FROM scores WHERE (submission_id IS NOT NULL AND submission_id = ?) OR content_hash = ? LIMIT 1');
        this.rankStmt = this.db.prepare(
            'SELECT COUNT(*) + 1 AS rank FROM scores WHERE points > ? OR (points = ? AND created_at < ?)');
        this.listStmt = this.db.prepare(
            `SELECT ${SUMMARY_COLUMNS} FROM scores ORDER BY points DESC, created_at ASC LIMIT ? OFFSET ?`);
        this.countStmt = this.db.prepare('SELECT COUNT(*) AS n FROM scores');
        this.countSinceStmt = this.db.prepare('SELECT COUNT(*) AS n FROM scores WHERE created_at >= ?');
        this.getStmt = this.db.prepare(`SELECT ${SUMMARY_COLUMNS}, submission FROM scores WHERE id = ?`);
        this.deleteStmt = this.db.prepare('DELETE FROM scores WHERE id = ?');
        this.verifyStmt = this.db.prepare('UPDATE scores SET verified = ? WHERE id = ?');
    }

    migrate() {
        const current = this.db.pragma('user_version', { simple: true });
        for (let v = current; v < MIGRATIONS.length; v++) {
            this.db.transaction(() => {
                this.db.exec(MIGRATIONS[v]);
                this.db.pragma(`user_version = ${v + 1}`);
            })();
        }
    }

    /*!
     * 検証済み envelope を 1 件登録する。
     * submission_id または内容ハッシュが既存の記録と一致する場合は登録せず、既存の記録を返す。
     * @returns {{ id: string, rank: number, duplicate: boolean }}
     */
    insert(submission, { flags, pointsComputed }) {
        const c = submission.character;
        const basic = c.basic || {};
        const status = c.status || {};
        const death = c.death || {};
        const progress = submission.progress;
        const game = submission.game || {};

        const points = pointsComputed !== null ? pointsComputed : submission.score.points;
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
            submission: JSON.stringify(submission),
            submission_id: submission.submission_id || null,
            content_hash: contentHash(submission),
        };

        const tx = this.db.transaction(() => {
            const existing = this.findDuplicateStmt.get(row.submission_id, row.content_hash);
            if (existing) {
                const rank = this.rankStmt.get(existing.points, existing.points, existing.created_at).rank;
                return { id: existing.id, rank, duplicate: true };
            }
            this.insertStmt.run(row);
            const rank = this.rankStmt.get(points, points, row.created_at).rank;
            return { id: row.id, rank, duplicate: false };
        });
        return tx();
    }

    list({ limit, offset }) {
        return this.listStmt.all(limit, offset).map(rowToSummary);
    }

    count() {
        return this.countStmt.get().n;
    }

    countSince(isoTimestamp) {
        return this.countSinceStmt.get(isoTimestamp).n;
    }

    get(id) {
        const row = this.getStmt.get(id);
        if (!row) {
            return null;
        }
        const summary = rowToSummary(row);
        summary.submission = JSON.parse(row.submission);
        return summary;
    }

    delete(id) {
        return this.deleteStmt.run(id).changes > 0;
    }

    setVerified(id, verified) {
        return this.verifyStmt.run(verified ? 1 : 0, id).changes > 0;
    }

    close() {
        this.db.close();
    }
}

module.exports = { ScoreStore, MIGRATIONS };
