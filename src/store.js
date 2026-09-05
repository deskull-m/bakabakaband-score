'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');

const SCHEMA_SQL = `
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
`;

const SUMMARY_COLUMNS = `
    id, created_at, name, race, class, sex, personality, level, max_level,
    depth, max_depth, gold, turns, play_time_sec, points, points_claimed,
    points_computed, death_cause, is_winner, game_version, platform, verified, flags
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
        this.db.exec(SCHEMA_SQL);

        this.insertStmt = this.db.prepare(`
            INSERT INTO scores (
                id, created_at, name, race, class, sex, personality, level, max_level,
                depth, max_depth, gold, turns, play_time_sec, points_claimed, points_computed,
                points, death_cause, is_winner, game_version, platform, verified, flags, submission
            ) VALUES (
                @id, @created_at, @name, @race, @class, @sex, @personality, @level, @max_level,
                @depth, @max_depth, @gold, @turns, @play_time_sec, @points_claimed, @points_computed,
                @points, @death_cause, @is_winner, @game_version, @platform, @verified, @flags, @submission
            )`);
        this.rankStmt = this.db.prepare(
            'SELECT COUNT(*) + 1 AS rank FROM scores WHERE points > ? OR (points = ? AND created_at < ?)');
        this.listStmt = this.db.prepare(
            `SELECT ${SUMMARY_COLUMNS} FROM scores ORDER BY points DESC, created_at ASC LIMIT ? OFFSET ?`);
        this.countStmt = this.db.prepare('SELECT COUNT(*) AS n FROM scores');
        this.getStmt = this.db.prepare(`SELECT ${SUMMARY_COLUMNS}, submission FROM scores WHERE id = ?`);
        this.deleteStmt = this.db.prepare('DELETE FROM scores WHERE id = ?');
        this.verifyStmt = this.db.prepare('UPDATE scores SET verified = ? WHERE id = ?');
    }

    /*!
     * 検証済み envelope を 1 件登録する。
     * @returns {{ id: string, rank: number }}
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
        };

        const tx = this.db.transaction(() => {
            this.insertStmt.run(row);
            return this.rankStmt.get(points, points, row.created_at).rank;
        });
        const rank = tx();
        return { id: row.id, rank };
    }

    list({ limit, offset }) {
        return this.listStmt.all(limit, offset).map(rowToSummary);
    }

    count() {
        return this.countStmt.get().n;
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

module.exports = { ScoreStore };
