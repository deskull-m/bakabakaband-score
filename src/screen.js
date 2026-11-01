'use strict';

/*!
 * 画面ダンプ (bakabakaband-screen 形式) の補助。
 *
 * {
 *   format: 'bakabakaband-screen', version: 1,
 *   width, height,
 *   palette: ['#rrggbb', ...],          // 色番号 -> RGB
 *   rows: [ [[color, 'text'], ...], ... ] // 行ごとに [色番号, 文字列] の連続区間
 * }
 *
 * 旧形式 (ゲームが生成していた <font color> だらけの HTML) からの変換もここで行い、
 * 保存と描画は新形式だけを扱えばよいようにする。
 */

const SCREEN_FORMAT = 'bakabakaband-screen';
const MAX_PALETTE = 256;

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: '\'', nbsp: ' ' };

function decodeEntities(text) {
    return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, body) => {
        if (body[0] === '#') {
            const code = body[1].toLowerCase() === 'x' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
            return Number.isFinite(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m;
        }
        return Object.prototype.hasOwnProperty.call(ENTITIES, body.toLowerCase()) ? ENTITIES[body.toLowerCase()] : m;
    });
}

/*!
 * 旧形式の HTML (<pre> の中に <font color="#rrggbb"> で色分けしたテキスト) を新形式に変換する。
 * 変換できない (pre が無い等) 場合は null。
 */
function htmlToScreen(html) {
    if (typeof html !== 'string') {
        return null;
    }
    const m = html.match(/<pre[^>]*>([\s\S]*?)<\/pre>/i);
    if (!m) {
        return null;
    }
    let body = m[1].replace(/^\n/, '');
    const palette = [];
    const colorIndex = (hex) => {
        const h = hex.toLowerCase();
        let i = palette.indexOf(h);
        if (i < 0) {
            i = palette.length >= MAX_PALETTE ? 0 : palette.push(h) - 1;
        }
        return i;
    };
    const rows = [];
    let current = colorIndex('#ffffff');
    let width = 0;
    for (const line of body.split('\n')) {
        const runs = [];
        const re = /<font\s+color=["']?(#[0-9a-f]{6})["']?\s*>|<\/font\s*>|([^<]+|<)/gi;
        let mm;
        let text = '';
        let lineWidth = 0;
        const flush = () => {
            if (text.length > 0) {
                runs.push([current, text]);
                lineWidth += text.length;
                text = '';
            }
        };
        while ((mm = re.exec(line)) !== null) {
            if (mm[1]) {
                flush();
                current = colorIndex(mm[1]);
            } else if (mm[0].toLowerCase().startsWith('</font')) {
                // 閉じタグは色の終わりを意味するだけで、次の font タグまで同じ色が続くとみなす
            } else {
                text += decodeEntities(mm[2]);
            }
        }
        flush();
        if (runs.length > 0) {
            const last = runs[runs.length - 1];
            last[1] = last[1].replace(/\s+$/, '');
            if (last[1].length === 0) {
                runs.pop();
            }
        }
        rows.push(runs);
        width = Math.max(width, lineWidth);
    }
    while (rows.length > 0 && rows[rows.length - 1].length === 0) {
        rows.pop();
    }
    if (rows.length === 0) {
        return null;
    }
    return {
        format: SCREEN_FORMAT,
        version: 1,
        width: Math.max(width, 80),
        height: rows.length,
        palette,
        rows,
        converted_from: 'html',
    };
}

/*!
 * 画面を色なしのプレーンテキストにする (コピー用、検索用)。
 */
function screenToText(screen) {
    return screen.rows.map((runs) => runs.map((r) => r[1]).join('').replace(/\s+$/, '')).join('\n') + '\n';
}

module.exports = { SCREEN_FORMAT, htmlToScreen, screenToText, decodeEntities };
