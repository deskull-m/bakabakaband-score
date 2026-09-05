'use strict';

const { loadConfig } = require('../src/config');
const { createApp } = require('../src/app');

function startServer(overrides = {}) {
    const config = loadConfig(Object.assign({
        SCORES_DB: ':memory:',
        DISABLE_RATE_LIMIT: '1',
        ADMIN_TOKEN: 'test-admin-token',
    }, overrides));
    const { app, store } = createApp(config);
    return new Promise((resolve) => {
        const server = app.listen(0, '127.0.0.1', () => {
            const base = `http://127.0.0.1:${server.address().port}`;
            resolve({
                base,
                store,
                close: () => new Promise((done) => server.close(() => {
                    store.close();
                    done();
                })),
            });
        });
    });
}

function creatureStatus(overrides = {}) {
    return Object.assign({
        version: { format: 'bakabakaband-creature-status', version: 1 },
        basic: {
            name: 'テスト', level: 30, experience: 500000, max_experience: 500000,
            race: 'ホビット', class: '戦士', sex: '男性', personality: 'ふつう',
        },
        stats: [{ name: 'STR', current: 18, max: 18, use: 18, top: 18 }],
        status: {
            hitpoints: 0, max_hitpoints: 400, mana: 0, max_mana: 0, armor_class: 50,
            display_armor_class: 80, gold: 12345, dungeon_level: 40, max_dungeon_level: 45, game_turn: 1234567,
        },
        death: { is_dead: true, cause: 'モルゴス', last_message: 'ぐわー' },
        history: ['ホビットの子として生まれた。'],
    }, overrides);
}

function envelope(overrides = {}) {
    const base = {
        format: 'bakabakaband-score-submission',
        format_version: 1,
        game: { version: '0.0.1-test', platform: 'x11', locale: 'ja' },
        score: {
            points: 5045000,
            options: {
                preserve_mode: true, autoroller: true, smart_learn: true, smart_cheat: false,
                ironman_shops: false, ironman_smallest_floor: false, ironman_force_arena_floor: false,
                powerup_home: true, ironman_rooms: false, ironman_nightmare: false, ironman_downward: false,
            },
            arena_wins: -1,
        },
        progress: {
            max_level: 30, max_max_experience: 500000, real_turns: 123456, play_time_sec: 3600,
            max_depth_overall: 45, death_count: 0, total_winner: false, true_winner: false,
        },
        character: creatureStatus(),
    };
    return Object.assign(base, overrides);
}

async function postJson(base, path, body, headers = {}) {
    const res = await fetch(base + path, {
        method: 'POST',
        headers: Object.assign({ 'Content-Type': 'application/json' }, headers),
        body: typeof body === 'string' ? body : JSON.stringify(body),
    });
    return { status: res.status, body: await res.json() };
}

module.exports = { startServer, creatureStatus, envelope, postJson };
