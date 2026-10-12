'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, envelope, postJson } = require('./helpers');
const { assessSubmission } = require('../src/validate');
const { levelForExp, expFactor, suspicionOf, VERSION_RE, tables } = require('../src/plausibility');
const { ScoreStore, MIGRATIONS } = require('../src/store');

const race = (en) => tables.races.find((r) => r.en === en);
const cls = (en) => tables.classes.find((c) => c.en === en);
const flagsOf = (sub, opts) => assessSubmission(sub, false, opts).flags;

test('expFactor follows get_expfact(): android ignores class, klackon/sprite monk types get -15', () => {
    assert.equal(expFactor(race('Human'), cls('Warrior')), 100);
    assert.equal(expFactor(race('Hobbit'), cls('Warrior')), 110);
    assert.equal(expFactor(race('Android'), cls('Mage')), race('Android').exp);
    assert.equal(expFactor(race('Klackon'), cls('Monk')), race('Klackon').exp + cls('Monk').exp - 15);
    assert.equal(expFactor(race('Klackon'), cls('Warrior')), race('Klackon').exp);
});

test('levelForExp mirrors check_experience() with the player_exp table', () => {
    const h = race('Human');
    const w = cls('Warrior');
    assert.equal(levelForExp(0, h, w), 1);
    assert.equal(levelForExp(9, h, w), 1);
    assert.equal(levelForExp(10, h, w), 2);
    assert.equal(levelForExp(74999, h, w), 29);
    assert.equal(levelForExp(75000, h, w), 30);
    assert.equal(levelForExp(10000000, h, w), tables.max_level);
    // 係数 110 なら 82500 でレベル 30
    assert.equal(levelForExp(82499, race('Hobbit'), w), 29);
    assert.equal(levelForExp(82500, race('Hobbit'), w), 30);
    // アンドロイドは別テーブル
    assert.equal(levelForExp(39, race('Android'), w), 1);
    assert.equal(levelForExp(40, race('Android'), w), 2);
});

test('level_exp_mismatch / unknown_race / unknown_class', () => {
    assert.ok(!flagsOf(envelope()).includes('level_exp_mismatch'));
    const high = envelope();
    high.character.basic.level = 50;
    assert.ok(flagsOf(high).includes('level_exp_mismatch'));
    const low = envelope();
    low.character.basic.experience = 10;
    assert.ok(flagsOf(low).includes('level_exp_mismatch'));

    const odd = envelope();
    odd.character.basic.race = 'ドラゴンボーン';
    odd.character.basic.class = 'Necromancer';
    const f = flagsOf(odd);
    assert.ok(f.includes('unknown_race') && f.includes('unknown_class'));
    assert.ok(!f.includes('level_exp_mismatch'));

    // 英語タイトルでも引ける
    const en = envelope();
    en.character.basic.race = 'Hobbit';
    en.character.basic.class = 'Warrior';
    assert.ok(!flagsOf(en).some((x) => /unknown|mismatch/.test(x) && x !== 'score_mismatch'));
});

test('unknown_version accepts the game\'s own formats', () => {
    for (const v of ['0.0.2.0', '1.2.3', '馬鹿馬鹿蛮怒 0.0.2.0(Debug)', 'Bakabakaband 0.0.2.0-abc123', 'Bakabakaband 0.0.2.0(Stable)']) {
        assert.ok(VERSION_RE.test(v), v);
    }
    for (const v of ['latest', 'v1', '1.2', 'Hengband 3.0.0']) {
        assert.ok(!VERSION_RE.test(v), v);
    }
    const sub = envelope();
    sub.game.version = 'hacked';
    assert.ok(flagsOf(sub).includes('unknown_version'));
});

test('winner_flags_inconsistent, stat_out_of_range, depth_exceeds_dungeon_max, level_too_fast', () => {
    const w = envelope();
    w.progress.true_winner = true;
    w.progress.total_winner = false;
    assert.ok(flagsOf(w).includes('winner_flags_inconsistent'));

    const s = envelope();
    s.character.stats[0].max = tables.stat.max + 1;
    assert.ok(flagsOf(s).includes('stat_out_of_range'));
    const s2 = envelope();
    s2.character.stats[0].use = -5;
    assert.ok(flagsOf(s2).includes('stat_out_of_range'));

    const d = envelope();
    d.progress.max_depth = { ANGBAND: 128 };
    assert.ok(flagsOf(d).includes('depth_exceeds_dungeon_max'));
    const d2 = envelope();
    d2.progress.max_depth = { 'イークの洞穴': 14 };
    assert.ok(flagsOf(d2).includes('depth_exceeds_dungeon_max'));
    const d3 = envelope();
    d3.progress.max_depth = { Angband: 127, 'Yeek cave': 13 };
    assert.ok(!flagsOf(d3).includes('depth_exceeds_dungeon_max'));
    const deepest = Math.max(...tables.dungeons.map((x) => x.max_depth));
    const d4 = envelope();
    d4.progress.max_depth_overall = deepest + 1;
    assert.ok(flagsOf(d4).includes('depth_exceeds_dungeon_max'));
    const d5 = envelope();
    d5.progress.max_depth_overall = deepest;
    assert.ok(!flagsOf(d5).includes('depth_exceeds_dungeon_max'));

    const t = envelope();
    t.progress.real_turns = 100;
    assert.ok(!flagsOf(t).includes('level_too_fast'));
    assert.ok(flagsOf(t, { minTurnsPerLevel: 50 }).includes('level_too_fast'));
});

test('suspicion weights', () => {
    assert.equal(suspicionOf([]), 0);
    assert.equal(suspicionOf(['legacy_format']), 0);
    assert.equal(suspicionOf(['score_mismatch', 'unknown_version']), 2);
    assert.equal(suspicionOf(['level_exp_mismatch']), 3);
    assert.equal(suspicionOf(['never_heard_of']), 1);
});

test('records at or above the suspicion threshold are hidden by default but not lost', async () => {
    const srv = await startServer();
    try {
        const ok = envelope();
        ok.score.points = 94500;
        const okRes = await postJson(srv.base, '/submit', ok);
        assert.equal(okRes.body.suspicion, 0);
        assert.equal(okRes.body.rank, 1);

        const bad = envelope();
        bad.character.basic.name = 'cheater';
        bad.character.basic.level = 50;
        bad.progress.max_level = 50;
        bad.progress.max_max_experience = 99999999;
        const badRes = await postJson(srv.base, '/submit', bad);
        assert.ok(badRes.body.suspicion >= 3);
        assert.equal(badRes.body.rank, 1); // 可視の記録の中での順位

        const names = async (qs) => (await (await fetch(`${srv.base}/scores?${qs}`)).json()).scores.map((s) => s.name);
        assert.deepEqual(await names(''), ['テスト']);
        assert.deepEqual(await names('include_flagged=1'), ['cheater', 'テスト']);
        assert.deepEqual(await names('flagged=1'), ['cheater']);
        assert.equal((await (await fetch(`${srv.base}/scores`)).json()).total, 1);
        // 個別の取得はできる
        assert.equal((await fetch(`${srv.base}/scores/${badRes.body.id}`)).status, 200);
        // healthz の total は隠した分も数える
        assert.equal((await (await fetch(`${srv.base}/healthz`)).json()).total, 1);

        // 検証済みにすると表示される
        await fetch(`${srv.base}/scores/${badRes.body.id}/verify`, {
            method: 'POST', headers: { Authorization: 'Bearer test-admin-token', 'Content-Type': 'application/json' }, body: '{"verified":true}',
        });
        assert.deepEqual(await names(''), ['cheater', 'テスト']);
    } finally {
        await srv.close();
    }
});

test('threshold 0 disables hiding', async () => {
    const srv = await startServer({ SUSPICION_HIDE_THRESHOLD: '0' });
    try {
        const bad = envelope();
        bad.character.basic.level = 50;
        await postJson(srv.base, '/submit', bad);
        assert.equal((await (await fetch(`${srv.base}/scores`)).json()).total, 1);
    } finally {
        await srv.close();
    }
});

test('migration 7 computes suspicion from stored flags', () => {
    const store = new ScoreStore(':memory:');
    store.db.exec('DROP TABLE attachments; DROP TABLE admin_log; DROP TABLE scores');
    store.db.pragma('user_version = 0');
    for (let i = 0; i < 6; i++) {
        store.db.exec(MIGRATIONS[i]);
    }
    store.db.pragma('user_version = 6');
    store.db.prepare(`INSERT INTO scores (id, created_at, name, level, max_level, points_claimed, points, submission, content_hash, flags)
        VALUES ('old', '2026-01-01T00:00:00.000Z', 'n', 1, 1, 1, 1, '{}', 'h', '["level_exp_mismatch","score_mismatch"]')`).run();
    store.migrate();
    assert.equal(store.db.prepare('SELECT suspicion FROM scores WHERE id = ?').get('old').suspicion, 4);
    store.close();
});
