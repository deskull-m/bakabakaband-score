'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { computeMultiplier, computeScore } = require('../src/score');

test('multiplier: all defaults gives 150', () => {
    // preserve_mode off(+10), autoroller off(+10), smart_learn off(-20), powerup_home off(+50)
    assert.equal(computeMultiplier({}), 150);
});

test('multiplier: every bonus enabled', () => {
    const m = computeMultiplier({
        preserve_mode: true, autoroller: true, smart_learn: true, smart_cheat: true,
        ironman_shops: true, ironman_smallest_floor: true, ironman_force_arena_floor: true,
        powerup_home: true, ironman_rooms: true, ironman_nightmare: true,
    });
    assert.equal(m, 100 + 30 + 50 + 10 + 20 + 100 + 100);
});

test('score: (exp + 100*depth) * mult / 100', () => {
    assert.equal(computeScore({ maxMaxExp: 1000, maxDepthOverall: 10, multiplier: 100 }), 2000);
    assert.equal(computeScore({ maxMaxExp: 500000, maxDepthOverall: 45, multiplier: 100 }), 504500);
    assert.equal(computeScore({ maxMaxExp: 500000, maxDepthOverall: 45, multiplier: 150 }), 756750);
});

test('score: arena bonus, ironman_downward, death count, munchkin', () => {
    assert.equal(computeScore({ maxMaxExp: 0, maxDepthOverall: 0, multiplier: 100, arenaWins: 10 }), 10000);
    assert.equal(computeScore({ maxMaxExp: 0, maxDepthOverall: 0, multiplier: 100, arenaWins: 30 }), 900000);
    assert.equal(computeScore({ maxMaxExp: 1000, maxDepthOverall: 0, multiplier: 100, ironmanDownward: true }), 2000);
    assert.equal(computeScore({ maxMaxExp: 1000, maxDepthOverall: 0, multiplier: 100, deathCount: 1 }), 500);
    assert.equal(computeScore({ maxMaxExp: 1000, maxDepthOverall: 0, multiplier: 100, spectreBerserker: true }), 200);
    assert.equal(computeScore({ maxMaxExp: 1000, maxDepthOverall: 0, multiplier: 100, munchkin: true }), 1);
    assert.equal(computeScore({ maxMaxExp: 1000, maxDepthOverall: 0, multiplier: 100, munchkin: true, totalWinner: true }), 2);
});

test('score: stays within uint32 like the C++ implementation', () => {
    const s = computeScore({ maxMaxExp: 4294967295, maxDepthOverall: 127, multiplier: 520 });
    assert.ok(Number.isInteger(s) && s >= 0 && s <= 4294967295);
});
