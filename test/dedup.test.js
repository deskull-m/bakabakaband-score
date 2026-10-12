'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, envelope, postJson } = require('./helpers');
const { canonicalize, contentHash } = require('../src/canonical');
const { ScoreStore, MIGRATIONS } = require('../src/store');

test('canonicalize: key order does not matter, attachments and submission_id are ignored by contentHash', () => {
    assert.equal(canonicalize({ b: 1, a: [true, null, 'x'] }), '{"a":[true,null,"x"],"b":1}');
    const a = envelope({ submission_id: '11111111-1111-4111-8111-111111111111', attachments: { character_dump: 'x' } });
    const b = envelope();
    assert.equal(contentHash(a), contentHash(b));
    const c = envelope();
    c.character.basic.name = 'other';
    assert.notEqual(contentHash(a), contentHash(c));
});

test('submit: resending the same submission_id does not create a second record', async () => {
    const srv = await startServer();
    try {
        const sub = envelope({ submission_id: '11111111-1111-4111-8111-111111111111' });
        const first = await postJson(srv.base, '/submit', sub);
        assert.equal(first.status, 200);
        assert.equal(first.body.duplicate, false);

        // 再送では添付が違っていても同じ記録として扱う
        sub.attachments = { character_dump: 'retry' };
        const second = await postJson(srv.base, '/submit', sub);
        assert.equal(second.status, 200);
        assert.equal(second.body.duplicate, true);
        assert.equal(second.body.id, first.body.id);
        assert.equal((await (await fetch(srv.base + '/scores')).json()).total, 1);
    } finally {
        await srv.close();
    }
});

test('submit: identical content without submission_id is deduplicated by hash', async () => {
    const srv = await startServer();
    try {
        const first = await postJson(srv.base, '/submit', envelope());
        const second = await postJson(srv.base, '/submit', envelope());
        assert.equal(second.body.duplicate, true);
        assert.equal(second.body.id, first.body.id);

        const other = envelope();
        other.character.basic.name = 'another';
        const third = await postJson(srv.base, '/submit', other);
        assert.equal(third.body.duplicate, false);
        assert.equal((await (await fetch(srv.base + '/scores')).json()).total, 2);
    } finally {
        await srv.close();
    }
});

test('submit: rejects a malformed submission_id', async () => {
    const srv = await startServer();
    try {
        const { status } = await postJson(srv.base, '/submit', envelope({ submission_id: 'not-a-uuid' }));
        assert.equal(status, 400);
    } finally {
        await srv.close();
    }
});

test('store: migrations apply incrementally to a v1 database', () => {
    const store = new ScoreStore(':memory:');
    // v1 だけ適用した状態を作る
    store.db.exec('DROP TABLE scores');
    store.db.pragma('user_version = 0');
    store.db.exec(MIGRATIONS[0]);
    store.db.pragma('user_version = 1');
    store.migrate();
    assert.equal(store.db.pragma('user_version', { simple: true }), MIGRATIONS.length);
    const cols = store.db.prepare('PRAGMA table_info(scores)').all().map((c) => c.name);
    assert.ok(cols.includes('submission_id'));
    assert.ok(cols.includes('content_hash'));
    store.close();
});
