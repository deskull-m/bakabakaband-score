'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('zlib');
const { startServer, envelope, postJson } = require('./helpers');
const { htmlToScreen, screenToText, decodeEntities } = require('../src/screen');
const { ScoreStore, MIGRATIONS, normalizeAttachments } = require('../src/store');

const LEGACY = '<html>\n<body text="#ffffff" bgcolor="#000000">\n<pre>\n'
    + '<font color="#ffffff">@..#   </font><font color="#ff0000">&lt;D&gt;</font>   \n'
    + '<font color="#ffffff">  &amp;&quot;x&#39;</font><font color="#00ff00">行2</font>\n'
    + '</font>\n</pre>\n</body>\n</html>\n';

const SCREEN = {
    format: 'bakabakaband-screen', version: 1, width: 80, height: 3,
    palette: ['#000000', '#ffffff', '#ff0000'],
    rows: [[[1, '@..#'], [2, '<script>alert(1)</script>']], [], [[1, '全角']]],
};

test('htmlToScreen converts legacy font-tag HTML into runs and a palette', () => {
    const s = htmlToScreen(LEGACY);
    assert.equal(s.format, 'bakabakaband-screen');
    assert.equal(s.converted_from, 'html');
    assert.deepEqual(s.palette, ['#ffffff', '#ff0000', '#00ff00']);
    assert.deepEqual(s.rows[0], [[0, '@..#   '], [1, '<D>']]);
    assert.deepEqual(s.rows[1], [[0, '  &"x\''], [2, '行2']]);
    assert.equal(s.height, 2);
    assert.equal(s.width, 80);
    assert.equal(screenToText(s), '@..#   <D>\n  &"x\'行2\n');
    assert.equal(htmlToScreen('no pre here'), null);
    assert.equal(htmlToScreen(42), null);
    assert.equal(decodeEntities('&#x40;&#64;&unknown;'), '@@&unknown;');
});

test('normalizeAttachments keeps JSON screens and derives one from legacy HTML', () => {
    const a = normalizeAttachments({ screen: SCREEN, character_dump: 'd' });
    assert.deepEqual(Object.keys(a).sort(), ['character_dump', 'screen']);
    assert.equal(JSON.parse(a.screen).rows[2][0][1], '全角');
    const b = normalizeAttachments({ screen_dump: LEGACY });
    assert.deepEqual(Object.keys(b).sort(), ['screen', 'screen_dump']);
    assert.equal(JSON.parse(b.screen).converted_from, 'html');
    assert.deepEqual(normalizeAttachments(undefined), {});
});

test('submit: screen JSON is stored and served as application/json', async () => {
    const srv = await startServer();
    try {
        const { status, body } = await postJson(srv.base, '/submit', envelope({ attachments: { screen: SCREEN } }));
        assert.equal(status, 200);
        const entry = await (await fetch(`${srv.base}/scores/${body.id}`)).json();
        assert.deepEqual(Object.keys(entry.attachments), ['screen']);
        const res = await fetch(`${srv.base}/scores/${body.id}/attachments/screen`);
        assert.match(res.headers.get('content-type'), /^application\/json/);
        assert.equal(res.headers.get('content-security-policy'), 'sandbox');
        assert.deepEqual(await res.json(), SCREEN);
    } finally {
        await srv.close();
    }
});

test('submit: legacy screen_dump is kept and a converted screen is added', async () => {
    const srv = await startServer();
    try {
        const { body } = await postJson(srv.base, '/submit', envelope({ attachments: { screen_dump: LEGACY } }));
        const entry = await (await fetch(`${srv.base}/scores/${body.id}`)).json();
        assert.deepEqual(Object.keys(entry.attachments).sort(), ['screen', 'screen_dump']);
        const screen = await (await fetch(`${srv.base}/scores/${body.id}/attachments/screen`)).json();
        assert.equal(screen.converted_from, 'html');
        assert.equal(screen.rows[0][1][1], '<D>');
    } finally {
        await srv.close();
    }
});

test('schema: malformed screens are rejected', async () => {
    const srv = await startServer();
    try {
        const bad = [
            Object.assign({}, SCREEN, { palette: ['red'] }),
            Object.assign({}, SCREEN, { rows: [[[1]]] }),
            Object.assign({}, SCREEN, { rows: [[['1', 'x']]] }),
            Object.assign({}, SCREEN, { format: 'other' }),
            Object.assign({}, SCREEN, { width: 0 }),
        ];
        for (const screen of bad) {
            const { status } = await postJson(srv.base, '/submit', envelope({ attachments: { screen } }));
            assert.equal(status, 400, JSON.stringify(screen).slice(0, 60));
        }
    } finally {
        await srv.close();
    }
});

test('migration 8 derives screens for existing legacy attachments', () => {
    const store = new ScoreStore(':memory:');
    store.db.exec('DROP TABLE attachments; DROP TABLE admin_log; DROP TABLE scores');
    store.db.pragma('user_version = 0');
    for (let i = 0; i < 7; i++) {
        store.db.exec(MIGRATIONS[i]);
    }
    store.db.pragma('user_version = 7');
    store.db.prepare(`INSERT INTO scores (id, created_at, name, level, max_level, points_claimed, points, submission, content_hash)
        VALUES ('old', '2026-01-01T00:00:00.000Z', 'n', 1, 1, 1, 1, '{}', 'h')`).run();
    store.db.prepare('INSERT INTO attachments (score_id, kind, size, body_gz) VALUES (?, ?, ?, ?)')
        .run('old', 'screen_dump', LEGACY.length, zlib.gzipSync(LEGACY));
    store.migrate();
    const screen = store.getAttachment('old', 'screen');
    assert.ok(screen);
    assert.equal(screen.mediaType, 'application/json');
    assert.equal(JSON.parse(screen.body).rows[0][1][1], '<D>');
    store.close();
});

test('pages: /screen is served without inline scripts', async () => {
    const srv = await startServer();
    try {
        const res = await fetch(srv.base + '/screen?id=x');
        assert.equal(res.status, 200);
        const html = await res.text();
        assert.match(html, /screen\.js/);
        assert.doesNotMatch(html, /<script>[^]*?\S[^]*?<\/script>/);
    } finally {
        await srv.close();
    }
});
