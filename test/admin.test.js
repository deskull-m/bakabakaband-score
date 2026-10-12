'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');

// サーバがテストプロセス内で動いているので、同期実行すると要求を処理できず固まる
const execFileAsync = promisify(execFile);
const { startServer, envelope, postJson } = require('./helpers');

const AUTH = { Authorization: 'Bearer test-admin-token' };

test('soft delete hides the record, restore brings it back, purge removes it', async () => {
    const srv = await startServer();
    try {
        const { body } = await postJson(srv.base, '/submit', envelope({ attachments: { character_dump: 'x' } }));
        const url = `${srv.base}/scores/${body.id}`;

        const del = await fetch(url, { method: 'DELETE', headers: Object.assign({ 'X-Admin-Reason': 'test' }, AUTH) });
        assert.deepEqual(await del.json(), { success: true, purged: false });
        assert.equal((await fetch(url)).status, 404);
        assert.equal((await fetch(`${url}/attachments/character_dump`)).status, 404);
        assert.equal((await (await fetch(srv.base + '/scores')).json()).total, 0);
        assert.equal(srv.store.db.prepare('SELECT COUNT(*) AS n FROM scores').get().n, 1);

        // 管理 API では見える
        const adminView = await (await fetch(`${srv.base}/admin/scores/${body.id}`, { headers: AUTH })).json();
        assert.ok(adminView.deleted_at);
        assert.equal((await fetch(`${srv.base}/admin/scores/${body.id}`)).status, 401);

        // 削除済みの記録と同じ内容の再送は通らない
        const resend = await postJson(srv.base, '/submit', envelope());
        assert.equal(resend.body.duplicate, true);
        assert.equal(resend.body.rank, null);

        assert.equal((await fetch(`${url}/restore`, { method: 'POST', headers: AUTH })).status, 200);
        assert.equal((await fetch(url)).status, 200);
        assert.equal((await fetch(`${url}/restore`, { method: 'POST', headers: AUTH })).status, 404);

        const purge = await fetch(`${url}?purge=1`, { method: 'DELETE', headers: AUTH });
        assert.deepEqual(await purge.json(), { success: true, purged: true });
        assert.equal(srv.store.db.prepare('SELECT COUNT(*) AS n FROM scores').get().n, 0);
        assert.equal(srv.store.db.prepare('SELECT COUNT(*) AS n FROM attachments').get().n, 0);

        const log = await (await fetch(`${srv.base}/admin/log`, { headers: AUTH })).json();
        assert.deepEqual(log.log.map((e) => e.action), ['purge', 'restore', 'delete']);
        assert.equal(log.log[2].detail, 'test');
    } finally {
        await srv.close();
    }
});

test('GET /scores?flagged=1 lists only unverified flagged records', async () => {
    const srv = await startServer();
    try {
        const clean = envelope();
        clean.score.points = 504500;
        const cleanRes = await postJson(srv.base, '/submit', clean);
        const flaggedA = envelope();
        flaggedA.character.basic.name = 'A';
        const a = await postJson(srv.base, '/submit', flaggedA);
        const flaggedB = envelope();
        flaggedB.character.basic.name = 'B';
        const b = await postJson(srv.base, '/submit', flaggedB);
        assert.equal(cleanRes.body.flags.length, 0);
        assert.ok(a.body.flags.length > 0 && b.body.flags.length > 0);

        await fetch(`${srv.base}/scores/${b.body.id}/verify`, {
            method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, AUTH), body: '{"verified":true}',
        });
        const data = await (await fetch(srv.base + '/scores?flagged=1')).json();
        assert.equal(data.total, 1);
        assert.deepEqual(data.scores.map((s) => s.id), [a.body.id]);
        assert.equal((await (await fetch(srv.base + '/scores')).json()).total, 3);
    } finally {
        await srv.close();
    }
});

test('admin CLI drives the admin API', async () => {
    const srv = await startServer();
    try {
        const { body } = await postJson(srv.base, '/submit', envelope());
        const script = path.join(__dirname, '..', 'scripts', 'admin.js');
        const run = async (...args) => (await execFileAsync('node', [script, ...args], {
            env: Object.assign({}, process.env, { SCORE_SERVER_URL: srv.base, ADMIN_TOKEN: 'test-admin-token' }),
        })).stdout;

        assert.match(await run('list-flagged'), /1 flagged record/);
        assert.match(await run('show', body.id), new RegExp(body.id));
        assert.match(await run('verify', body.id, 'looks fine'), /verified: true/);
        assert.match(await run('list-flagged'), /0 flagged record/);
        assert.match(await run('delete', body.id, 'cleanup'), /purged: false/);
        assert.match(await run('restore', body.id), /success: true/);
        assert.match(await run('purge', body.id), /purged: true/);
        const log = await run('log');
        assert.match(log, /verify .*looks fine/);
        assert.match(log, /purge/);

        await assert.rejects(execFileAsync('node', [script, 'show', 'x'], {
            env: Object.assign({}, process.env, { SCORE_SERVER_URL: srv.base, ADMIN_TOKEN: 'wrong' }),
        }), /401/);
    } finally {
        await srv.close();
    }
});
