'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('zlib');
const { startServer, envelope, postJson } = require('./helpers');
const { ScoreStore, MIGRATIONS } = require('../src/store');

const SCREEN = '<html><body><pre>@..#</pre><script>alert(1)</script></body></html>';

test('attachments: stored separately, listed with size, served as text/plain with sandbox CSP', async () => {
    const srv = await startServer();
    try {
        const sub = envelope({ attachments: { character_dump: 'dump あいう', screen_dump: SCREEN } });
        const { body } = await postJson(srv.base, '/submit', sub);

        const entry = await (await fetch(`${srv.base}/scores/${body.id}`)).json();
        assert.equal(entry.submission.attachments, undefined);
        assert.deepEqual(entry.attachments, {
            character_dump: { size: Buffer.byteLength('dump あいう') },
            screen_dump: { size: SCREEN.length },
        });

        const dump = await fetch(`${srv.base}/scores/${body.id}/attachments/character_dump`);
        assert.equal(dump.status, 200);
        assert.match(dump.headers.get('content-type'), /^text\/plain/);
        assert.equal(await dump.text(), 'dump あいう');

        const screen = await fetch(`${srv.base}/scores/${body.id}/attachments/screen_dump`);
        assert.match(screen.headers.get('content-type'), /^text\/plain/);
        assert.equal(screen.headers.get('content-security-policy'), 'sandbox');
        assert.equal(await screen.text(), SCREEN);

        assert.equal((await fetch(`${srv.base}/scores/${body.id}/attachments/other`)).status, 404);
        assert.equal((await fetch(`${srv.base}/scores/nope/attachments/character_dump`)).status, 404);

        // 列挙 API には添付が含まれない
        const list = await (await fetch(srv.base + '/scores')).json();
        assert.doesNotMatch(JSON.stringify(list), /alert\(1\)/);

        // DB 上は gzip 圧縮されている
        const row = srv.store.db.prepare('SELECT body_gz FROM attachments WHERE kind = ?').get('screen_dump');
        assert.equal(zlib.gunzipSync(row.body_gz).toString(), SCREEN);
    } finally {
        await srv.close();
    }
});

test('attachments: deleted together with the score', async () => {
    const srv = await startServer();
    try {
        const { body } = await postJson(srv.base, '/submit', envelope({ attachments: { character_dump: 'x' } }));
        await fetch(`${srv.base}/scores/${body.id}`, { method: 'DELETE', headers: { Authorization: 'Bearer test-admin-token' } });
        assert.equal(srv.store.db.prepare('SELECT COUNT(*) AS n FROM attachments').get().n, 0);
    } finally {
        await srv.close();
    }
});

test('attachments: a v3 database with embedded attachments is migrated', () => {
    const store = new ScoreStore(':memory:');
    store.db.exec('DROP TABLE attachments; DROP TABLE scores');
    store.db.pragma('user_version = 0');
    for (let i = 0; i < 3; i++) {
        store.db.exec(MIGRATIONS[i]);
    }
    store.db.pragma('user_version = 3');
    const sub = envelope({ attachments: { character_dump: 'legacy dump' } });
    store.db.prepare(`INSERT INTO scores (id, created_at, name, level, max_level, points_claimed, points, submission, content_hash)
        VALUES ('old', '2026-01-01T00:00:00.000Z', 'n', 1, 1, 1, 1, ?, 'h')`).run(JSON.stringify(sub));

    store.migrate();
    assert.equal(store.db.pragma('user_version', { simple: true }), MIGRATIONS.length);
    assert.equal(store.getAttachment('old', 'character_dump').body, 'legacy dump');
    assert.equal(JSON.parse(store.db.prepare('SELECT submission FROM scores WHERE id = ?').get('old').submission).attachments, undefined);
    store.close();
});
