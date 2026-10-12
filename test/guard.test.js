'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, envelope, postJson } = require('./helpers');
const { rateLimitKey, clientIp, startOfUtcDay, makeProxyWarning } = require('../src/guard');

test('rateLimitKey: IPv6 is bucketed by /64, IPv4 as-is', () => {
    assert.equal(rateLimitKey('2001:db8:1:2:3:4:5:6'), '2001:db8:1:2::/64');
    assert.equal(rateLimitKey('2001:db8:1:2:ffff:ffff:ffff:ffff'), '2001:db8:1:2::/64');
    assert.equal(rateLimitKey('203.0.113.5'), '203.0.113.5');
});

test('clientIp: uses CLIENT_IP_HEADER when configured, else req.ip', () => {
    const req = { ip: '10.0.0.1', get: (h) => (h === 'CF-Connecting-IP' ? ' 198.51.100.7 ' : undefined) };
    assert.equal(clientIp(req, { clientIpHeader: 'CF-Connecting-IP' }), '198.51.100.7');
    assert.equal(clientIp(req, { clientIpHeader: '' }), '10.0.0.1');
    assert.equal(clientIp(req, { clientIpHeader: 'X-Real-IP' }), '10.0.0.1');
});

test('startOfUtcDay', () => {
    assert.equal(startOfUtcDay(new Date('2026-10-12T23:59:59Z')), '2026-10-12T00:00:00.000Z');
});

test('proxy warning fires once when proxy headers arrive without TRUST_PROXY', () => {
    const logs = [];
    const mw = makeProxyWarning({ trustProxy: 0, clientIpHeader: '' }, (m) => logs.push(m));
    const req = { get: (h) => (h === 'x-forwarded-for' ? '1.2.3.4' : undefined) };
    mw(req, {}, () => {});
    mw(req, {}, () => {});
    assert.equal(logs.length, 1);
    const quiet = [];
    makeProxyWarning({ trustProxy: 1, clientIpHeader: '' }, (m) => quiet.push(m))(req, {}, () => {});
    assert.equal(quiet.length, 0);
});

test('daily cap: distinct submissions beyond SUBMIT_DAILY_MAX get 503, reads keep working', async () => {
    const srv = await startServer({ SUBMIT_DAILY_MAX: '2' });
    try {
        for (const n of ['a', 'b']) {
            const sub = envelope();
            sub.character.basic.name = n;
            assert.equal((await postJson(srv.base, '/submit', sub)).status, 200);
        }
        const sub = envelope();
        sub.character.basic.name = 'c';
        const { status, body } = await postJson(srv.base, '/submit', sub);
        assert.equal(status, 503);
        assert.match(body.error, /daily/);
        assert.equal((await fetch(srv.base + '/scores')).status, 200);
        assert.equal(srv.stats.capacity_rejected, 1);
    } finally {
        await srv.close();
    }
});

test('disk guard: submissions pause when free space is below MIN_FREE_DISK_MB', async () => {
    const path = require('path');
    const os = require('os');
    const fs = require('fs');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bbscore-'));
    const srv = await startServer({ SCORES_DB: path.join(dir, 'scores.sqlite'), MIN_FREE_DISK_MB: String(2 ** 40) });
    try {
        const { status, body } = await postJson(srv.base, '/submit', envelope());
        assert.equal(status, 503);
        assert.match(body.error, /storage/);
    } finally {
        await srv.close();
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('read rate limit applies to GET endpoints', async () => {
    const srv = await startServer({ DISABLE_RATE_LIMIT: '0', READ_RATE_MAX: '3', SUBMIT_RATE_MAX: '100' });
    try {
        for (let i = 0; i < 3; i++) {
            assert.equal((await fetch(srv.base + '/scores')).status, 200);
        }
        assert.equal((await fetch(srv.base + '/scores')).status, 429);
        assert.equal(srv.stats.rate_limited, 1);
    } finally {
        await srv.close();
    }
});

test('stats: accepted / duplicates / rejected / flagged are counted', async () => {
    const srv = await startServer();
    try {
        await postJson(srv.base, '/submit', envelope());
        await postJson(srv.base, '/submit', envelope());
        await postJson(srv.base, '/submit', { nope: true });
        await postJson(srv.base, '/submit', '{bad');
        assert.equal(srv.stats.accepted, 1);
        assert.equal(srv.stats.duplicates, 1);
        assert.equal(srv.stats.rejected, 2);
        assert.equal(srv.stats.flagged, 1); // score_mismatch
    } finally {
        await srv.close();
    }
});
