/* eslint-env browser */
'use strict';

(function () {
    const id = new URLSearchParams(location.search).get('id');
    const subtitle = document.getElementById('subtitle');
    if (!id) {
        subtitle.textContent = '記録の ID が指定されていません。';
        return;
    }
    const base = '/scores/' + encodeURIComponent(id);
    fetch(base).then(function (r) {
        if (!r.ok) { throw new Error('記録が見つかりません'); }
        return r.json();
    }).then(function (entry) {
        document.getElementById('title').textContent = entry.name + ' のスクリーンショット';
        document.title = entry.name + ' - Bakabakaband Screen';
        subtitle.textContent = [entry.race, entry.class, 'Lv' + entry.level, entry.death_cause || '', new Date(entry.created_at).toLocaleString()].filter(Boolean).join(' / ');
        const kinds = entry.attachments || {};
        if (kinds.screen) {
            return fetch(base + '/attachments/screen').then(function (r) { return r.json(); }).then(function (screen) {
                window.BakaScreen.createViewer(document.getElementById('viewer'), screen, { filename: entry.name + '.png' });
            });
        }
        if (kinds.screen_dump) {
            return fetch(base + '/attachments/screen_dump').then(function (r) { return r.text(); }).then(function (html) {
                document.getElementById('legacy').hidden = false;
                document.getElementById('legacy-frame').srcdoc = html;
            });
        }
        subtitle.textContent += ' / スクリーンショットはありません';
        return undefined;
    }).catch(function (err) {
        subtitle.textContent = err.message;
    });
})();
