'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { validateSubmission, assessSubmission } = require('../src/validate');
const { computeMultiplier, computeScore } = require('../src/score');
const { levelForExp, tables } = require('../src/plausibility');
const { startServer, postJson } = require('./helpers');

const fixturePath = path.join(__dirname, 'fixtures', 'submission-ja.json');
const load = () => JSON.parse(fs.readFileSync(fixturePath, 'utf8'));

test('fixture: the game-side envelope sample validates and is internally consistent', () => {
    const sub = load();
    const result = validateSubmission(sub);
    assert.equal(result.ok, true, result.error);
    assert.equal(result.legacy, false);

    // 乗数と点数はゲーム側と同じ式で求まる
    const mult = computeMultiplier(sub.score.options);
    assert.equal(mult, sub.score.multiplier);
    const expected = computeScore({
        maxMaxExp: sub.progress.max_max_experience, maxDepthOverall: sub.progress.max_depth_overall,
        multiplier: mult, arenaWins: sub.score.arena_wins, ironmanDownward: sub.score.options.ironman_downward,
        spectreBerserker: false, deathCount: 0, munchkin: false, totalWinner: false,
    });
    sub.score.points = expected;

    // レベルは経験値と種族・職業の係数から導かれる
    const race = tables.races.find((r) => r.ja === sub.character.basic.race);
    const cls = tables.classes.find((c) => c.ja === sub.character.basic.class);
    assert.equal(levelForExp(sub.character.basic.experience, race, cls), sub.character.basic.level);

    const assessment = assessSubmission(sub, false);
    assert.deepEqual(assessment.flags, []);
    assert.equal(assessment.suspicion, 0);
});

test('fixture: round-trips through the server with attachments', async () => {
    const srv = await startServer();
    try {
        const sub = load();
        sub.score.points = computeScore({
            maxMaxExp: sub.progress.max_max_experience, maxDepthOverall: sub.progress.max_depth_overall,
            multiplier: computeMultiplier(sub.score.options), arenaWins: sub.score.arena_wins,
        });
        const { status, body } = await postJson(srv.base, '/submit', sub);
        assert.equal(status, 200);
        assert.deepEqual(body.flags, []);
        const entry = await (await fetch(`${srv.base}/scores/${body.id}`)).json();
        assert.equal(entry.name, 'ガラドリエル');
        assert.equal(entry.game_version, '馬鹿馬鹿蛮怒 0.0.2.0(開発版)');
        assert.equal(entry.submission_id, sub.submission_id);
        assert.ok(entry.attachments.screen_dump.size > 0);
        const screen = await (await fetch(`${srv.base}/scores/${body.id}/attachments/screen_dump`)).text();
        assert.match(screen, /<pre>/);
    } finally {
        await srv.close();
    }
});
