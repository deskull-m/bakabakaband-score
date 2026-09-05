'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, creatureStatus, envelope, postJson } = require('./helpers');

test('submit: accepts a valid envelope and recomputes the score', async () => {
    const srv = await startServer();
    try {
        const { status, body } = await postJson(srv.base, '/submit', envelope());
        assert.equal(status, 200);
        assert.equal(body.success, true);
        assert.equal(body.rank, 1);
        // mult 100 (all bonuses off): (500000 + 100*45) * 100 / 100
        assert.equal(body.points, 504500);
        assert.deepEqual(body.flags, ['score_mismatch']);

        const list = await (await fetch(srv.base + '/scores')).json();
        assert.equal(list.total, 1);
        assert.equal(list.scores[0].points, 504500);
        assert.equal(list.scores[0].points_claimed, 5045000);
        assert.equal(list.scores[0].name, 'テスト');
        assert.equal(list.scores[0].verified, false);
    } finally {
        await srv.close();
    }
});

test('submit: claimed score matching the recomputation has no flags', async () => {
    const srv = await startServer();
    try {
        const sub = envelope();
        sub.score.points = 504500;
        const { body } = await postJson(srv.base, '/submit', sub);
        assert.deepEqual(body.flags, []);
    } finally {
        await srv.close();
    }
});

test('submit: accepts the legacy creature-status dump and flags it', async () => {
    const srv = await startServer();
    try {
        const { status, body } = await postJson(srv.base, '/submit', creatureStatus());
        assert.equal(status, 200);
        assert.ok(body.flags.includes('legacy_format'));
        assert.ok(body.flags.includes('score_not_recomputable'));
        const entry = await (await fetch(`${srv.base}/scores/${body.id}`)).json();
        assert.equal(entry.submission.format, 'bakabakaband-score-submission');
        assert.equal(entry.submission.character.basic.name, 'テスト');
    } finally {
        await srv.close();
    }
});

test('submit: rejects unknown formats, malformed JSON and schema violations', async () => {
    const srv = await startServer();
    try {
        assert.equal((await postJson(srv.base, '/submit', { hello: 'world' })).status, 400);
        assert.equal((await postJson(srv.base, '/submit', '{not json')).status, 400);
        assert.equal((await postJson(srv.base, '/submit', '[1,2,3]')).status, 400);

        const tooLongName = envelope();
        tooLongName.character.basic.name = 'x'.repeat(65);
        assert.equal((await postJson(srv.base, '/submit', tooLongName)).status, 400);

        const negativePoints = envelope();
        negativePoints.score.points = -1;
        assert.equal((await postJson(srv.base, '/submit', negativePoints)).status, 400);

        const extraTopLevel = envelope({ evil: true });
        assert.equal((await postJson(srv.base, '/submit', extraTopLevel)).status, 400);
    } finally {
        await srv.close();
    }
});

test('submit: rejects oversized bodies', async () => {
    const srv = await startServer({ BODY_LIMIT: '2kb' });
    try {
        const big = envelope({ attachments: { character_dump: 'x'.repeat(4096) } });
        const { status } = await postJson(srv.base, '/submit', big);
        assert.equal(status, 413);
    } finally {
        await srv.close();
    }
});

test('submit: implausible values are stored with flags, not rejected', async () => {
    const srv = await startServer();
    try {
        const sub = envelope();
        sub.character.basic.level = 60;
        sub.character.basic.experience = 999999;
        sub.progress.real_turns = 0;
        sub.character.death = {};
        const { status, body } = await postJson(srv.base, '/submit', sub);
        assert.equal(status, 200);
        for (const f of ['level_out_of_range', 'level_exceeds_max_level', 'exp_exceeds_max', 'zero_turns', 'not_dead']) {
            assert.ok(body.flags.includes(f), f);
        }
    } finally {
        await srv.close();
    }
});

test('scores: ranking order, pagination and untouched hostile strings', async () => {
    const srv = await startServer();
    try {
        const hostile = '&#39;);alert(1);//<script>';
        for (const [name, exp] of [['low', 1000], [hostile, 3000], ['mid', 2000]]) {
            const sub = envelope();
            sub.character.basic.name = name;
            sub.progress.max_max_experience = exp;
            await postJson(srv.base, '/submit', sub);
        }
        const page = await (await fetch(srv.base + '/scores?limit=2&offset=0')).json();
        assert.equal(page.total, 3);
        assert.deepEqual(page.scores.map((s) => s.name), [hostile, 'mid']);
        const rest = await (await fetch(srv.base + '/scores?limit=2&offset=2')).json();
        assert.deepEqual(rest.scores.map((s) => s.name), ['low']);

        const res = await fetch(srv.base + '/scores');
        assert.match(res.headers.get('content-type'), /application\/json/);
        assert.equal(res.headers.get('access-control-allow-origin'), '*');
    } finally {
        await srv.close();
    }
});

test('admin: delete and verify require the bearer token', async () => {
    const srv = await startServer();
    try {
        const { body } = await postJson(srv.base, '/submit', envelope());
        const url = `${srv.base}/scores/${body.id}`;

        assert.equal((await fetch(url, { method: 'DELETE' })).status, 401);
        assert.equal((await fetch(url, { method: 'DELETE', headers: { Authorization: 'Bearer wrong' } })).status, 401);

        const verify = await postJson(srv.base, `/scores/${body.id}/verify`, { verified: true },
            { Authorization: 'Bearer test-admin-token' });
        assert.equal(verify.status, 200);
        assert.equal((await (await fetch(url)).json()).verified, true);

        const del = await fetch(url, { method: 'DELETE', headers: { Authorization: 'Bearer test-admin-token' } });
        assert.equal(del.status, 200);
        assert.equal((await fetch(url)).status, 404);
    } finally {
        await srv.close();
    }
});

test('admin: operations are disabled when ADMIN_TOKEN is unset', async () => {
    const srv = await startServer({ ADMIN_TOKEN: '' });
    try {
        const res = await fetch(`${srv.base}/scores/whatever`, {
            method: 'DELETE', headers: { Authorization: 'Bearer anything' },
        });
        assert.equal(res.status, 503);
    } finally {
        await srv.close();
    }
});

test('rate limit: submit is throttled per client', async () => {
    const srv = await startServer({ DISABLE_RATE_LIMIT: '0', SUBMIT_RATE_MAX: '2' });
    try {
        assert.equal((await postJson(srv.base, '/submit', envelope())).status, 200);
        assert.equal((await postJson(srv.base, '/submit', envelope())).status, 200);
        assert.equal((await postJson(srv.base, '/submit', envelope())).status, 429);
    } finally {
        await srv.close();
    }
});

test('pages: static pages are served with a CSP and no inline script', async () => {
    const srv = await startServer();
    try {
        for (const p of ['/', '/leaderboard']) {
            const res = await fetch(srv.base + p);
            assert.equal(res.status, 200);
            assert.match(res.headers.get('content-security-policy'), /script-src 'self'/);
            const html = await res.text();
            assert.doesNotMatch(html, /<script>[^]*?\S[^]*?<\/script>/);
            assert.doesNotMatch(html, /onclick=/);
        }
    } finally {
        await srv.close();
    }
});
