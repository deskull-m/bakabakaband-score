'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const Database = require('better-sqlite3');
const { startServer, envelope, postJson } = require('./helpers');

test('healthz: reports ok, totals and is not cached', async () => {
    const srv = await startServer();
    try {
        await postJson(srv.base, '/submit', envelope());
        const res = await fetch(srv.base + '/healthz');
        assert.equal(res.status, 200);
        assert.equal(res.headers.get('cache-control'), 'no-store');
        const body = await res.json();
        assert.equal(body.ok, true);
        assert.equal(body.total, 1);
        assert.equal(body.submissions_today, 1);
        assert.ok(body.uptime_sec >= 0);
    } finally {
        await srv.close();
    }
});

test('healthz: is exempt from the read rate limit', async () => {
    const srv = await startServer({ DISABLE_RATE_LIMIT: '0', READ_RATE_MAX: '1' });
    try {
        for (let i = 0; i < 3; i++) {
            assert.equal((await fetch(srv.base + '/healthz')).status, 200);
        }
    } finally {
        await srv.close();
    }
});

test('backup script: writes a consistent copy and prunes old ones', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bbscore-'));
    const dbPath = path.join(dir, 'scores.sqlite');
    const srv = await startServer({ SCORES_DB: dbPath });
    try {
        await postJson(srv.base, '/submit', envelope());
        const outDir = path.join(dir, 'backups');
        fs.mkdirSync(outDir);
        fs.writeFileSync(path.join(outDir, 'scores-2000-01-01T00-00-00-000Z.sqlite'), '');
        const script = path.join(__dirname, '..', 'scripts', 'backup.js');
        const out = execFileSync('node', [script, outDir], {
            env: Object.assign({}, process.env, { SCORES_DB: dbPath, BACKUP_KEEP: '1' }),
        }).toString();
        assert.match(out, /backup written/);
        assert.match(out, /removed old backup: scores-2000/);
        const files = fs.readdirSync(outDir);
        assert.equal(files.length, 1);
        const copy = new Database(path.join(outDir, files[0]), { readonly: true });
        assert.equal(copy.prepare('SELECT COUNT(*) AS n FROM scores').get().n, 1);
        copy.close();
    } finally {
        await srv.close();
        fs.rmSync(dir, { recursive: true, force: true });
    }
});
