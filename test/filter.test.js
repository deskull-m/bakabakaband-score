'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, envelope, postJson } = require('./helpers');
const { levelForExp, tables } = require('../src/plausibility');

// 種族・職業ごとに経験値係数が違うので、レベルを経験値から導いて妥当な記録にする
function consistentLevel(exp, raceTitle, classTitle) {
    const race = tables.races.find((r) => r.ja === raceTitle);
    const cls = tables.classes.find((c) => c.ja === classTitle);
    return levelForExp(exp, race, cls);
}

async function seed(srv) {
    const rows = [
        { name: 'ElfMage', race: 'エルフ', cls: 'メイジ', exp: 1000, winner: false, version: '1.0.0', cause: 'オーク' },
        { name: 'HobWar', race: 'ホビット', cls: '戦士', exp: 3000, winner: false, version: '1.0.0', cause: 'モルゴス' },
        { name: 'ElfWar', race: 'エルフ', cls: '戦士', exp: 2000, winner: true, version: '1.1.0', cause: 'ripe' },
        { name: 'Dwarf_x', race: 'ドワーフ', cls: '戦士', exp: 500, winner: false, version: '1.1.0', cause: 'モルゴス' },
    ];
    const ids = {};
    for (const r of rows) {
        const sub = envelope();
        sub.character.basic.name = r.name;
        sub.character.basic.race = r.race;
        sub.character.basic.class = r.cls;
        sub.character.basic.experience = r.exp * 100;
        sub.character.basic.max_experience = r.exp * 100;
        sub.character.basic.level = consistentLevel(r.exp * 100, r.race, r.cls);
        sub.progress.max_level = sub.character.basic.level;
        sub.progress.max_max_experience = r.exp * 100;
        sub.progress.true_winner = r.winner;
        sub.progress.total_winner = r.winner;
        sub.game.version = r.version;
        sub.character.death.cause = r.cause;
        ids[r.name] = (await postJson(srv.base, '/submit', sub)).body.id;
    }
    return ids;
}

async function names(srv, qs) {
    const data = await (await fetch(`${srv.base}/scores?${qs}`)).json();
    return data.scores.map((s) => s.name);
}

test('scores: filters by race, class, winner, version, name and date', async () => {
    const srv = await startServer();
    try {
        await seed(srv);
        assert.deepEqual(await names(srv, ''), ['HobWar', 'ElfWar', 'ElfMage', 'Dwarf_x']);
        assert.deepEqual(await names(srv, 'race=' + encodeURIComponent('エルフ')), ['ElfWar', 'ElfMage']);
        assert.deepEqual(await names(srv, 'class=' + encodeURIComponent('戦士') + '&race=' + encodeURIComponent('エルフ')), ['ElfWar']);
        assert.deepEqual(await names(srv, 'winner=1'), ['ElfWar']);
        assert.deepEqual(await names(srv, 'version=1.1.0'), ['ElfWar', 'Dwarf_x']);
        assert.deepEqual(await names(srv, 'name=elf'), ['ElfWar', 'ElfMage']);
        // LIKE のワイルドカードはエスケープされる
        assert.deepEqual(await names(srv, 'name=_x'), ['Dwarf_x']);
        assert.deepEqual(await names(srv, 'name=%25'), []);
        assert.deepEqual(await names(srv, 'since=2000-01-01&until=2000-01-02'), []);
        assert.deepEqual(await names(srv, 'since=2000-01-01'), ['HobWar', 'ElfWar', 'ElfMage', 'Dwarf_x']);
        // 不正な日付は無視される
        assert.equal((await names(srv, 'since=yesterday')).length, 4);

        const data = await (await fetch(`${srv.base}/scores?winner=1&race=${encodeURIComponent('エルフ')}&bogus=1`)).json();
        assert.equal(data.total, 1);
        assert.deepEqual(data.filter, { race: 'エルフ', winner: true });
    } finally {
        await srv.close();
    }
});

test('scores: sort=recent orders by created_at desc', async () => {
    const srv = await startServer();
    try {
        await seed(srv);
        const recent = await names(srv, 'sort=recent');
        assert.deepEqual(recent, ['Dwarf_x', 'ElfWar', 'HobWar', 'ElfMage']);
    } finally {
        await srv.close();
    }
});

test('stats: totals, per-race/class bests, death causes, versions', async () => {
    const srv = await startServer();
    try {
        const ids = await seed(srv);
        const res = await fetch(srv.base + '/stats');
        assert.match(res.headers.get('cache-control'), /max-age=60/);
        const st = await res.json();
        assert.equal(st.totals.total, 4);
        assert.equal(st.totals.winners, 1);
        const elf = st.by_race.find((r) => r.key === 'エルフ');
        assert.equal(elf.count, 2);
        assert.equal(elf.winners, 1);
        assert.equal(elf.best_name, 'ElfWar');
        assert.equal(elf.best_id, ids.ElfWar);
        const warrior = st.by_class.find((r) => r.key === '戦士');
        assert.equal(warrior.count, 3);
        assert.equal(warrior.best_name, 'HobWar');
        // 勝者は死因に数えない
        assert.deepEqual(st.by_death_cause, [{ cause: 'モルゴス', count: 2 }, { cause: 'オーク', count: 1 }]);
        assert.deepEqual(st.by_version.map((v) => v.version).sort(), ['1.0.0', '1.1.0']);

        // 論理削除された記録は集計から外れる
        await fetch(`${srv.base}/scores/${ids.HobWar}`, { method: 'DELETE', headers: { Authorization: 'Bearer test-admin-token' } });
        const after = await (await fetch(srv.base + '/stats')).json();
        assert.equal(after.totals.total, 3);
        assert.equal(after.by_class.find((r) => r.key === '戦士').best_name, 'ElfWar');
    } finally {
        await srv.close();
    }
});
