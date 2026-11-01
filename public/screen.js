/* eslint-env browser */
'use strict';

// bakabakaband-screen 形式 (行ごとの [色番号, 文字列] の run) を DOM / canvas に描画する。
// 文字列は textContent / fillText でしか扱わないので、画面に何が含まれていても HTML としては解釈されない。
(function () {
    const FULLWIDTH = /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]|[\ud83c-\ud83e][\udc00-\udfff]/;

    function cellsOf(ch) {
        return FULLWIDTH.test(ch) ? 2 : 1;
    }

    function hexToRgb(hex) {
        const n = parseInt(hex.slice(1), 16);
        return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    }

    function rgbToHex(r, g, b) {
        return '#' + [r, g, b].map(function (v) { return Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0'); }).join('');
    }

    function luminance(hex) {
        const c = hexToRgb(hex);
        return (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255;
    }

    // パレットの変種。original はゲームの色そのまま
    const PALETTES = {
        original: function (p) { return p.slice(); },
        contrast: function (p) {
            return p.map(function (hex, i) {
                if (i === 0) { return hex; }
                const l = luminance(hex);
                if (l >= 0.45) { return hex; }
                const c = hexToRgb(hex);
                const k = 0.45 / Math.max(l, 0.05);
                return rgbToHex(c[0] * k + 40, c[1] * k + 40, c[2] * k + 40);
            });
        },
        mono: function (p) {
            return p.map(function (hex, i) { return i === 0 ? hex : '#e0e0e0'; });
        },
        green: function (p) {
            return p.map(function (hex, i) {
                if (i === 0) { return hex; }
                const l = 0.45 + 0.55 * luminance(hex);
                return rgbToHex(40 * l, 255 * l, 60 * l);
            });
        },
    };

    const DEFAULTS = { fontSize: 14, lineHeight: 1.2, palette: 'original', background: '#000000', highlightPlayer: true };

    function resolvePalette(screen, name) {
        const fn = PALETTES[name] || PALETTES.original;
        return fn(screen.palette || ['#ffffff']);
    }

    function rowText(runs) {
        return runs.map(function (r) { return r[1]; }).join('');
    }

    /*!
     * DOM に描画する。container の中身は置き換える。
     */
    function render(container, screen, opts) {
        const o = Object.assign({}, DEFAULTS, opts || {});
        const palette = resolvePalette(screen, o.palette);
        const pre = document.createElement('pre');
        pre.className = 'baka-screen';
        pre.style.fontSize = o.fontSize + 'px';
        pre.style.lineHeight = String(o.lineHeight);
        pre.style.background = o.background;
        pre.style.color = palette[1] || '#ffffff';
        pre.dataset.width = screen.width;
        pre.dataset.height = screen.height;
        const rows = screen.rows || [];
        for (let y = 0; y < Math.max(rows.length, screen.height || 0); y++) {
            const line = document.createElement('span');
            line.className = 'baka-screen-row';
            let cells = 0;
            (rows[y] || []).forEach(function (run) {
                const span = document.createElement('span');
                span.style.color = palette[run[0]] || palette[1] || '#ffffff';
                span.textContent = run[1];
                if (o.highlightPlayer && y > 0 && run[1].indexOf('@') >= 0) {
                    span.classList.add('baka-screen-has-player');
                }
                line.appendChild(span);
                for (const ch of run[1]) { cells += cellsOf(ch); }
            });
            if (screen.width && cells < screen.width) {
                line.appendChild(document.createTextNode(' '.repeat(screen.width - cells)));
            }
            pre.appendChild(line);
            pre.appendChild(document.createTextNode('\n'));
        }
        container.replaceChildren(pre);
        return pre;
    }

    function toText(screen) {
        return (screen.rows || []).map(function (runs) { return rowText(runs).replace(/\s+$/, ''); }).join('\n') + '\n';
    }

    /*!
     * canvas に描画する (PNG 保存用)。全角は 2 セル分進める。
     */
    function toCanvas(screen, opts) {
        const o = Object.assign({}, DEFAULTS, opts || {});
        const palette = resolvePalette(screen, o.palette);
        const font = o.fontSize + 'px "Courier New", "MS Gothic", "Osaka-Mono", monospace';
        const probe = document.createElement('canvas').getContext('2d');
        probe.font = font;
        const cw = Math.ceil(probe.measureText('M').width);
        const ch = Math.ceil(o.fontSize * o.lineHeight);
        const width = screen.width || Math.max.apply(null, (screen.rows || []).map(function (r) { return rowText(r).length; }).concat([80]));
        const height = Math.max((screen.rows || []).length, screen.height || 0);
        const canvas = document.createElement('canvas');
        canvas.width = cw * width;
        canvas.height = ch * height;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = o.background;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.font = font;
        ctx.textBaseline = 'top';
        (screen.rows || []).forEach(function (runs, y) {
            let x = 0;
            runs.forEach(function (run) {
                ctx.fillStyle = palette[run[0]] || palette[1] || '#ffffff';
                for (const c of run[1]) {
                    const n = cellsOf(c);
                    if (c !== ' ') {
                        ctx.fillText(c, x * cw, y * ch);
                    }
                    x += n;
                }
            });
        });
        return canvas;
    }

    function loadPrefs() {
        try {
            return Object.assign({}, DEFAULTS, JSON.parse(localStorage.getItem('baka-screen-prefs') || '{}'));
        } catch (e) {
            return Object.assign({}, DEFAULTS);
        }
    }

    function savePrefs(prefs) {
        try {
            localStorage.setItem('baka-screen-prefs', JSON.stringify(prefs));
        } catch (e) {
            // 保存できなくても描画には影響しない
        }
    }

    function el(tag, text, className) {
        const node = document.createElement(tag);
        if (text !== undefined) { node.textContent = text; }
        if (className) { node.className = className; }
        return node;
    }

    /*!
     * 操作パネル付きのビューアを作る。
     * @param container 描画先
     * @param screen 画面データ
     * @param options { filename: PNG 保存時のファイル名 }
     */
    function createViewer(container, screen, options) {
        const opt = options || {};
        const prefs = loadPrefs();
        const root = el('div', undefined, 'baka-screen-viewer');
        const bar = el('div', undefined, 'baka-screen-controls');
        const area = el('div', undefined, 'baka-screen-area');

        const sizeLabel = el('label', '文字サイズ ');
        const size = document.createElement('input');
        size.type = 'range';
        size.min = '8';
        size.max = '32';
        size.step = '1';
        size.value = String(prefs.fontSize);
        sizeLabel.appendChild(size);
        const sizeValue = el('span', prefs.fontSize + 'px');
        sizeLabel.appendChild(sizeValue);

        const palLabel = el('label', '配色 ');
        const pal = document.createElement('select');
        [['original', 'オリジナル'], ['contrast', '高コントラスト'], ['mono', 'モノクロ'], ['green', 'グリーン']].forEach(function (p) {
            const o = el('option', p[1]);
            o.value = p[0];
            pal.appendChild(o);
        });
        pal.value = prefs.palette;
        palLabel.appendChild(pal);

        const bgLabel = el('label', '背景 ');
        const bg = document.createElement('select');
        [['#000000', '黒'], ['#101820', '紺'], ['#1a1a1a', '灰']].forEach(function (p) {
            const o = el('option', p[1]);
            o.value = p[0];
            bg.appendChild(o);
        });
        bg.value = prefs.background;
        bgLabel.appendChild(bg);

        const hl = document.createElement('input');
        hl.type = 'checkbox';
        hl.checked = Boolean(prefs.highlightPlayer);
        const hlLabel = el('label', ' @ を強調');
        hlLabel.insertBefore(hl, hlLabel.firstChild);

        const copyBtn = el('button', 'テキストをコピー');
        copyBtn.type = 'button';
        const pngBtn = el('button', 'PNG を保存');
        pngBtn.type = 'button';
        const info = el('span', (screen.width || '?') + 'x' + (screen.height || (screen.rows || []).length) + (screen.converted_from ? ' (旧形式から変換)' : ''), 'baka-screen-info');

        [sizeLabel, palLabel, bgLabel, hlLabel, copyBtn, pngBtn, info].forEach(function (n) { bar.appendChild(n); });
        root.appendChild(bar);
        root.appendChild(area);
        container.replaceChildren(root);

        function current() {
            return { fontSize: Number(size.value), palette: pal.value, background: bg.value, highlightPlayer: hl.checked, lineHeight: prefs.lineHeight };
        }
        function redraw() {
            const c = current();
            sizeValue.textContent = c.fontSize + 'px';
            render(area, screen, c);
            savePrefs(c);
        }
        size.addEventListener('input', redraw);
        pal.addEventListener('change', redraw);
        bg.addEventListener('change', redraw);
        hl.addEventListener('change', redraw);
        copyBtn.addEventListener('click', function () {
            const text = toText(screen);
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(text).then(function () { copyBtn.textContent = 'コピーしました'; }, function () { copyBtn.textContent = 'コピーできませんでした'; });
            } else {
                copyBtn.textContent = 'コピーできませんでした';
            }
            setTimeout(function () { copyBtn.textContent = 'テキストをコピー'; }, 1500);
        });
        pngBtn.addEventListener('click', function () {
            const canvas = toCanvas(screen, current());
            canvas.toBlob(function (blob) {
                if (!blob) { return; }
                const a = document.createElement('a');
                a.href = URL.createObjectURL(blob);
                a.download = opt.filename || 'screen.png';
                a.click();
                setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
            }, 'image/png');
        });
        redraw();
        return { redraw: redraw, root: root };
    }

    window.BakaScreen = { render: render, toText: toText, toCanvas: toCanvas, createViewer: createViewer, palettes: Object.keys(PALETTES) };
})();
