/* eslint-env browser */
'use strict';

// サーバはHTMLを組み立てず、ブラウザ側で textContent / DOM API だけを使って描画する。
// 文字列連結で innerHTML を作らないことで、キャラ名や遺言経由の XSS を構造的に防ぐ。

(function () {
    const tbody = document.querySelector('#scores tbody');
    const table = document.getElementById('scores');
    const empty = document.getElementById('empty');
    const subtitle = document.getElementById('subtitle');
    const hideFlagged = document.getElementById('hide-flagged');
    const dialog = document.getElementById('detail');

    function el(tag, text, className) {
        const node = document.createElement(tag);
        if (text !== undefined && text !== null) {
            node.textContent = String(text);
        }
        if (className) {
            node.className = className;
        }
        return node;
    }

    function badge(text, kind) {
        return el('span', text, 'badge badge-' + kind);
    }

    function formatDate(iso) {
        const d = new Date(iso);
        return Number.isNaN(d.getTime()) ? '-' : d.toLocaleString();
    }

    function renderRow(score, index) {
        const tr = document.createElement('tr');
        tr.dataset.id = score.id;
        const rankClass = index < 3 ? 'rank-' + (index + 1) : '';
        tr.appendChild(el('td', index + 1, rankClass));

        const nameCell = el('td');
        nameCell.appendChild(el('strong', score.name));
        if (score.is_winner) {
            nameCell.appendChild(badge('WINNER', 'winner'));
        }
        if (score.verified) {
            nameCell.appendChild(badge('検証済', 'verified'));
        } else if (score.flags.length > 0) {
            const b = badge('要確認', 'flag');
            b.title = score.flags.join(', ');
            nameCell.appendChild(b);
        }
        tr.appendChild(nameCell);

        tr.appendChild(el('td', score.race || '-'));
        tr.appendChild(el('td', score.class || '-'));
        tr.appendChild(el('td', score.level));
        tr.appendChild(el('td', score.depth > 0 ? 'D:' + score.depth : '-'));
        tr.appendChild(el('td', score.points.toLocaleString()));
        tr.appendChild(el('td', score.death_cause || '-'));
        tr.appendChild(el('td', score.game_version || '-'));
        tr.appendChild(el('td', formatDate(score.created_at)));
        tr.addEventListener('click', function () {
            openDetail(score.id);
        });
        return tr;
    }

    async function load() {
        subtitle.textContent = '読み込み中...';
        const res = await fetch('/scores?limit=200');
        const data = await res.json();
        let scores = data.scores;
        if (hideFlagged.checked) {
            scores = scores.filter(function (s) {
                return s.verified || s.flags.length === 0;
            });
        }
        tbody.replaceChildren();
        scores.forEach(function (score, i) {
            tbody.appendChild(renderRow(score, i));
        });
        table.hidden = scores.length === 0;
        empty.hidden = scores.length !== 0;
        subtitle.textContent = '登録数: ' + data.total + ' 件';
    }

    function addItem(dl, label, value) {
        if (value === undefined || value === null || value === '') {
            return;
        }
        dl.appendChild(el('dt', label));
        dl.appendChild(el('dd', value));
    }

    function showTab(name) {
        dialog.querySelectorAll('[data-panel]').forEach(function (panel) {
            panel.hidden = panel.dataset.panel !== name;
        });
    }

    async function openDetail(id) {
        const res = await fetch('/scores/' + encodeURIComponent(id));
        if (!res.ok) {
            return;
        }
        const entry = await res.json();
        const sub = entry.submission || {};
        const c = sub.character || {};
        const basic = c.basic || {};
        const status = c.status || {};
        const death = c.death || {};

        document.getElementById('detail-title').textContent = entry.name;

        const dl = document.getElementById('detail-status');
        dl.replaceChildren();
        addItem(dl, 'スコア', entry.points.toLocaleString());
        addItem(dl, '申告スコア', entry.points_claimed.toLocaleString());
        addItem(dl, '種族', basic.race);
        addItem(dl, '職業', basic.class);
        addItem(dl, '性別', basic.sex);
        addItem(dl, '性格', basic.personality);
        addItem(dl, '魔法領域', [basic.realm1, basic.realm2].filter(Boolean).join(' / '));
        addItem(dl, 'レベル', basic.level + ' (最高 ' + entry.max_level + ')');
        addItem(dl, '経験値', basic.experience);
        addItem(dl, 'HP', status.hitpoints + ' / ' + status.max_hitpoints);
        addItem(dl, 'MP', status.mana + ' / ' + status.max_mana);
        addItem(dl, 'AC', status.display_armor_class);
        addItem(dl, '所持金', status.gold);
        addItem(dl, '現在階', status.dungeon_level);
        addItem(dl, '最深階', entry.max_depth);
        addItem(dl, 'ターン', entry.turns);
        addItem(dl, 'プレイ時間', entry.play_time_sec !== null ? Math.floor(entry.play_time_sec / 60) + ' 分' : null);
        addItem(dl, '死因', death.cause);
        addItem(dl, '遺言', death.last_message);
        addItem(dl, 'バージョン', entry.game_version);
        addItem(dl, '登録日時', formatDate(entry.created_at));
        addItem(dl, '検証状態', entry.verified ? '検証済' : (entry.flags.length ? '要確認: ' + entry.flags.join(', ') : '未検証'));
        (c.history || []).forEach(function (line, i) {
            addItem(dl, '履歴 ' + (i + 1), line);
        });

        const attachments = sub.attachments || {};
        document.getElementById('detail-dump').textContent = attachments.character_dump || '(添付なし)';
        // スクリーンショットは HTML なので、スクリプト実行不可の sandbox iframe に閉じ込める
        document.getElementById('detail-screen').srcdoc = attachments.screen_dump || '<p>(添付なし)</p>';
        document.getElementById('detail-json').textContent = JSON.stringify(sub, null, 2);

        showTab('status');
        dialog.showModal();
    }

    dialog.querySelectorAll('[data-tab]').forEach(function (button) {
        button.addEventListener('click', function () {
            showTab(button.dataset.tab);
        });
    });
    document.getElementById('detail-close').addEventListener('click', function () {
        dialog.close();
    });
    document.getElementById('refresh').addEventListener('click', load);
    hideFlagged.addEventListener('change', load);

    load().catch(function (err) {
        subtitle.textContent = '読み込みに失敗しました: ' + err.message;
    });
    setInterval(function () {
        if (!dialog.open) {
            load().catch(function () {});
        }
    }, 60000);
})();
