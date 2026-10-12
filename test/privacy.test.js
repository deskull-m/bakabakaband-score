'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, envelope, postJson } = require('./helpers');

test('privacy: no column or stored field holds the client address', async () => {
    const srv = await startServer({ TRUST_PROXY: '1' });
    try {
        await postJson(srv.base, '/submit', envelope(), { 'X-Forwarded-For': '198.51.100.77' });
        const tables = srv.store.db.prepare('SELECT name FROM sqlite_master WHERE type = \'table\'').all();
        for (const { name } of tables) {
            const cols = srv.store.db.prepare(`PRAGMA table_info(${name})`).all().map((c) => c.name);
            for (const col of cols) {
                assert.doesNotMatch(col, /ip|addr|remote|forwarded/i, `${name}.${col}`);
            }
        }
        const rows = srv.store.db.prepare('SELECT * FROM scores').all();
        assert.doesNotMatch(JSON.stringify(rows), /198\.51\.100\.77/);
    } finally {
        await srv.close();
    }
});

test('privacy: the top page states what is published and how to request deletion', async () => {
    const srv = await startServer();
    try {
        const html = await (await fetch(srv.base + '/')).text();
        assert.match(html, /id="privacy"/);
        assert.match(html, /IP アドレスは記録に保存しません/);
        assert.match(html, /削除依頼/);
    } finally {
        await srv.close();
    }
});
