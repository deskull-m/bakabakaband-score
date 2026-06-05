// Bakabakaband スコアダンプ解析の簡易テスト (依存ライブラリ無し)
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { parseDump, computeScore, firstNumber } = require('../index');

let passed = 0;
function test(name, fn) {
    try {
        fn();
        passed++;
        console.log('  ✅ ' + name);
    } catch (err) {
        console.error('  ❌ ' + name);
        console.error('     ' + err.message);
        process.exitCode = 1;
    }
}

const sample = JSON.parse(
    fs.readFileSync(path.join(__dirname, '..', 'sample-dump.json'), 'utf8'),
);

console.log('parseDump (Bakabakaband 正式フォーマット)');

test('基本情報を抽出する', () => {
    const p = parseDump(sample);
    assert.strictEqual(p.characterName, 'ヒーロー');
    assert.strictEqual(p.race, 'ハーフエルフ');
    assert.strictEqual(p.class, '戦士');
    assert.strictEqual(p.sex, '男性');
    assert.strictEqual(p.level, 50);
});

test('ステータスを抽出する', () => {
    const p = parseDump(sample);
    assert.strictEqual(p.maxHp, 620);
    assert.strictEqual(p.gold, 250000);
    assert.strictEqual(p.dungeonLevel, 88);
    assert.strictEqual(p.maxDungeonLevel, 99);
});

test('死亡情報を抽出する', () => {
    const p = parseDump(sample);
    assert.strictEqual(p.isDead, true);
    assert.strictEqual(p.isWinner, false);
    assert.strictEqual(p.deathCause, 'Morgoth, Lord of Darkness');
});

test('スコアは max_experience + 100 * max_dungeon_level', () => {
    const p = parseDump(sample);
    assert.strictEqual(p.score, 12345678 + 100 * 99);
    assert.strictEqual(computeScore(sample.basic, sample.status), p.score);
});

test('勝利フラグを認識する', () => {
    const winner = JSON.parse(JSON.stringify(sample));
    winner.death = { is_winner: true };
    const p = parseDump(winner);
    assert.strictEqual(p.isWinner, true);
    assert.strictEqual(p.isDead, false);
});

test('生存中 (death セクション無し) を扱える', () => {
    const alive = JSON.parse(JSON.stringify(sample));
    delete alive.death;
    const p = parseDump(alive);
    assert.strictEqual(p.isDead, false);
    assert.strictEqual(p.isWinner, false);
    assert.strictEqual(p.deathCause, '冒険中');
});

test('旧フラット形式にもフォールバックする', () => {
    const legacy = { name: 'Old', race: 'Human', class: 'Mage', max_plv: 30 };
    const p = parseDump(legacy);
    assert.strictEqual(p.characterName, 'Old');
    assert.strictEqual(p.race, 'Human');
    assert.strictEqual(p.level, 30);
});

console.log('firstNumber');

test('最初の有限数を返す', () => {
    assert.strictEqual(firstNumber(null, undefined, NaN, 7), 7);
    assert.strictEqual(firstNumber(undefined, 0, 5), 0);
    assert.strictEqual(firstNumber(), 0);
});

console.log('');
console.log(passed + ' checks passed.');
