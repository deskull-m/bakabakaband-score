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
    const filters = document.getElementById('filters');
    const pager = document.getElementById('pager');
    const statsSection = document.getElementById('stats');
    const PAGE_SIZE = 100;

    // 表示状態は URL のクエリに持ち、共有できるようにする
    function readState() {
        const q = new URLSearchParams(location.search);
        return {
            sort: ['points', 'recent', 'stats'].indexOf(q.get('sort')) >= 0 ? q.get('sort') : 'points',
            page: Math.max(0, parseInt(q.get('page') || '0', 10) || 0),
            race: q.get('race') || '',
            class: q.get('class') || '',
            version: q.get('version') || '',
            name: q.get('name') || '',
            since: q.get('since') || '',
            until: q.get('until') || '',
            winner: q.get('winner') === '1',
            hideFlagged: q.get('hide_flagged') === '1',
        };
    }

    function writeState(state) {
        const q = new URLSearchParams();
        if (state.sort !== 'points') { q.set('sort', state.sort); }
        if (state.page > 0) { q.set('page', String(state.page)); }
        ['race', 'class', 'version', 'name', 'since', 'until'].forEach(function (k) {
            if (state[k]) { q.set(k, state[k]); }
        });
        if (state.winner) { q.set('winner', '1'); }
        if (state.hideFlagged) { q.set('hide_flagged', '1'); }
        const qs = q.toString();
        history.replaceState(null, '', location.pathname + (qs ? '?' + qs : ''));
    }

    function stateFromForm(prev) {
        return {
            sort: prev.sort === 'stats' ? 'points' : prev.sort,
            page: 0,
            race: filters.race.value,
            class: filters.class.value,
            version: filters.version.value,
            name: filters.name.value.trim(),
            since: filters.since.value,
            until: filters.until.value,
            winner: filters.winner.checked,
            hideFlagged: hideFlagged.checked,
        };
    }

    function formFromState(state) {
        filters.race.value = state.race;
        filters.class.value = state.class;
        filters.version.value = state.version;
        filters.name.value = state.name;
        filters.since.value = state.since;
        filters.until.value = state.until;
        filters.winner.checked = state.winner;
        hideFlagged.checked = state.hideFlagged;
        document.querySelectorAll('.tab').forEach(function (b) {
            b.classList.toggle('active', b.dataset.sort === state.sort);
        });
    }

    function queryFromState(state) {
        const q = new URLSearchParams();
        q.set('limit', String(PAGE_SIZE));
        q.set('offset', String(state.page * PAGE_SIZE));
        q.set('sort', state.sort);
        ['race', 'class', 'version', 'name', 'since'].forEach(function (k) {
            if (state[k]) { q.set(k, state[k]); }
        });
        if (state.until) {
            // 日付指定は「その日の終わりまで」
            const d = new Date(state.until + 'T00:00:00Z');
            d.setUTCDate(d.getUTCDate() + 1);
            q.set('until', d.toISOString());
        }
        if (state.winner) { q.set('winner', '1'); }
        return q.toString();
    }

    let state = readState();

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
        const rank = state.page * PAGE_SIZE + index + 1;
        const rankClass = state.sort === 'points' && rank <= 3 ? 'rank-' + rank : '';
        tr.appendChild(el('td', state.sort === 'points' ? rank : '', rankClass));

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
        formFromState(state);
        writeState(state);
        if (state.sort === 'stats') {
            table.hidden = true;
            empty.hidden = true;
            pager.hidden = true;
            statsSection.hidden = false;
            return loadStats();
        }
        statsSection.hidden = true;
        subtitle.textContent = '読み込み中...';
        const res = await fetch('/scores?' + queryFromState(state));
        const data = await res.json();
        let scores = data.scores;
        if (state.hideFlagged) {
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
        const pages = Math.max(1, Math.ceil(data.total / PAGE_SIZE));
        pager.hidden = pages <= 1;
        document.getElementById('page-info').textContent = (state.page + 1) + ' / ' + pages;
        document.getElementById('prev').disabled = state.page <= 0;
        document.getElementById('next').disabled = state.page >= pages - 1;
        subtitle.textContent = '該当 ' + data.total + ' 件';
        return undefined;
    }

    function fillSelect(select, rows, keyName, label) {
        const current = select.value;
        select.replaceChildren(el('option', label + ': すべて'));
        select.firstChild.value = '';
        rows.forEach(function (r) {
            const o = el('option', r[keyName] + ' (' + r.count + ')');
            o.value = r[keyName];
            select.appendChild(o);
        });
        select.value = current;
    }

    let statsLoaded = null;
    async function fetchStats() {
        if (!statsLoaded) {
            statsLoaded = fetch('/stats').then(function (r) { return r.json(); });
        }
        return statsLoaded;
    }

    async function loadFilterOptions() {
        const st = await fetchStats();
        fillSelect(filters.race, st.by_race, 'key', '種族');
        fillSelect(filters.class, st.by_class, 'key', '職業');
        fillSelect(filters.version, st.by_version, 'version', 'バージョン');
        formFromState(state);
    }

    function fillTable(id, rows, cells) {
        const body = document.querySelector('#' + id + ' tbody');
        body.replaceChildren();
        rows.forEach(function (r) {
            const tr = document.createElement('tr');
            cells(r).forEach(function (c) { tr.appendChild(el('td', c)); });
            body.appendChild(tr);
        });
    }

    async function loadStats() {
        subtitle.textContent = '集計';
        const st = await fetchStats();
        const dl = document.getElementById('stats-totals');
        dl.replaceChildren();
        addItem(dl, '登録数', st.totals.total);
        addItem(dl, '勝者', st.totals.winners);
        addItem(dl, '検証済', st.totals.verified);
        addItem(dl, '最初の記録', st.totals.first ? formatDate(st.totals.first) : null);
        addItem(dl, '最新の記録', st.totals.last ? formatDate(st.totals.last) : null);
        const bestCells = function (r) {
            return [r.key, r.count, r.winners, r.best_points.toLocaleString(), r.best_name];
        };
        fillTable('stats-race', st.by_race, bestCells);
        fillTable('stats-class', st.by_class, bestCells);
        fillTable('stats-death', st.by_death_cause, function (r) { return [r.cause, r.count]; });
    }

    function addItem(dl, label, value) {
        if (value === undefined || value === null || value === '') {
            return;
        }
        dl.appendChild(el('dt', label));
        dl.appendChild(el('dd', value));
    }

    let pendingAttachments = null;

    async function fetchAttachment(kind) {
        if (!pendingAttachments || !pendingAttachments.kinds[kind]) {
            return null;
        }
        const res = await fetch('/scores/' + encodeURIComponent(pendingAttachments.id) + '/attachments/' + kind);
        delete pendingAttachments.kinds[kind];
        return res.ok ? res.text() : null;
    }

    function showTab(name) {
        dialog.querySelectorAll('[data-panel]').forEach(function (panel) {
            panel.hidden = panel.dataset.panel !== name;
        });
        if (name === 'dump') {
            fetchAttachment('character_dump').then(function (text) {
                if (text !== null) {
                    document.getElementById('detail-dump').textContent = text;
                }
            });
        } else if (name === 'screen') {
            // スクリーンショットは HTML なので、スクリプト実行不可の sandbox iframe に閉じ込める
            fetchAttachment('screen_dump').then(function (text) {
                if (text !== null) {
                    document.getElementById('detail-screen').srcdoc = text;
                }
            });
        }
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

        // 添付は大きいので、タブを開いたときに個別に取得する
        const attachments = entry.attachments || {};
        pendingAttachments = { id: id, kinds: attachments };
        document.getElementById('detail-dump').textContent = attachments.character_dump ? '(読み込み中...)' : '(添付なし)';
        document.getElementById('detail-screen').srcdoc = attachments.screen_dump ? '<p>(読み込み中...)</p>' : '<p>(添付なし)</p>';
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
    function reload() {
        load().catch(function (err) {
            subtitle.textContent = '読み込みに失敗しました: ' + err.message;
        });
    }

    filters.addEventListener('submit', function (e) {
        e.preventDefault();
        state = stateFromForm(state);
        reload();
    });
    hideFlagged.addEventListener('change', function () {
        state = stateFromForm(state);
        reload();
    });
    document.getElementById('clear').addEventListener('click', function () {
        state = { sort: state.sort === 'stats' ? 'points' : state.sort, page: 0, race: '', class: '', version: '', name: '', since: '', until: '', winner: false, hideFlagged: false };
        reload();
    });
    document.querySelectorAll('.tab').forEach(function (b) {
        b.addEventListener('click', function () {
            state.sort = b.dataset.sort;
            state.page = 0;
            reload();
        });
    });
    document.getElementById('prev').addEventListener('click', function () {
        state.page = Math.max(0, state.page - 1);
        reload();
    });
    document.getElementById('next').addEventListener('click', function () {
        state.page += 1;
        reload();
    });

    loadFilterOptions().catch(function () {});
    reload();
    setInterval(function () {
        if (!dialog.open && state.sort !== 'stats') {
            statsLoaded = null;
            load().catch(function () {});
        }
    }, 60000);
})();
