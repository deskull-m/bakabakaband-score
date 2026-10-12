'use strict';

/*!
 * ゲーム本体 (deskull-m/bakabakaband) のソースから、妥当性チェックに使う定数表を抜き出す。
 *
 *   node scripts/extract-game-tables.js /path/to/bakabakaband > src/data/game-tables.json
 *
 * 抜き出すもの:
 *   - レベルごとの必要経験値 (player_exp / player_exp_a)
 *   - 種族・職業の経験値係数と日英の名称
 *   - ダンジョンの最深階と日英の名称
 *   - 能力値の内部表現の範囲
 * 本体側の表が変わったら再実行してコミットする。
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = process.argv[2];
if (!root) {
    console.error('usage: extract-game-tables.js <bakabakaband repo dir>');
    process.exit(2);
}
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
const nums = (s) => s.split(',').map((x) => x.trim()).filter(Boolean).map(Number);

function expTable(src, name) {
    const m = src.match(new RegExp(`${name}\\[PY_MAX_LEVEL\\]\\s*=\\s*\\{([^}]*)\\}`));
    if (!m) {
        throw new Error(`${name} not found`);
    }
    return nums(stripComments(m[1]).replace(/L/g, ''));
}

function enumValues(src, enumName) {
    const body = src.match(new RegExp(`enum class ${enumName}[^{]*\\{([\\s\\S]*?)\\};`))[1];
    const out = [];
    for (const m of stripComments(body).matchAll(/([A-Z_][A-Z0-9_]*)\s*=\s*(\d+)/g)) {
        out.push({ tag: m[1], id: Number(m[2]) });
    }
    return out;
}

function races() {
    const src = stripComments(read('src/player/race-info-table.cpp'));
    const tags = enumValues(read('src/player-info/race-types.h'), 'PlayerRaceType').filter((e) => e.tag !== 'MAX');
    // { "jp", "en" }, "h", { adj x6 }, 8 skills, r_mhp, r_exp, ...
    const re = /\{\s*"([^"]+)",\s*"([^"]+)"\s*\},\s*"[^"]*",\s*\{[^}]*\},\s*(?:-?\d+\s*,\s*){8}\s*\d+\s*,\s*(\d+)/g;
    const out = [];
    let i = 0;
    for (const m of src.matchAll(re)) {
        const tag = tags[i] ? tags[i].tag : `RACE_${i}`;
        out.push({ id: i, tag, ja: m[1], en: m[2], exp: Number(m[3]) });
        i += 1;
    }
    if (out.length !== tags.length) {
        throw new Error(`race count mismatch: table ${out.length}, enum ${tags.length}`);
    }
    return out;
}

function classes() {
    const src = stripComments(read('src/player-info/class-info.cpp'));
    const ids = Object.fromEntries(enumValues(read('src/player-info/class-types.h'), 'PlayerClassType').map((e) => [e.tag, e.id]));
    // PlayerClassType::X, { { "jp", "en" }, { adj x6 }, 8 c_, 8 x_, c_mhp, c_exp, ...
    const re = /PlayerClassType::([A-Z_]+),\s*\{\s*\{\s*"([^"]+)",\s*"([^"]+)"\s*\},\s*\{[^}]*\},\s*(?:-?\d+\s*,\s*){17}\s*(-?\d+)/g;
    const out = [];
    for (const m of src.matchAll(re)) {
        out.push({ id: ids[m[1]], tag: m[1], ja: m[2], en: m[3], exp: Number(m[4]) });
    }
    const expected = Object.keys(ids).filter((t) => t !== 'MAX').length;
    if (out.length !== expected) {
        throw new Error(`class count mismatch: table ${out.length}, enum ${expected}`);
    }
    return out;
}

function dungeons() {
    const jsonc = read('lib/edit/DungeonDefinitions.jsonc');
    const json = JSON.parse(stripComments(jsonc).replace(/,(\s*[}\]])/g, '$1'));
    return json.dungeons.map((d) => ({
        id: d.id, tag: d.tag, ja: d.name.ja, en: d.name.en, max_depth: d.generation.max_depth,
    }));
}

function statRange() {
    const src = read('src/player-ability/player-ability-types.h');
    return {
        min: Number(src.match(/STAT_MIN_VALUE\s*=\s*(\d+)/)[1]),
        max: Number(src.match(/STAT_MAX_VALUE\s*=\s*(\d+)/)[1]),
    };
}

function version() {
    const src = read('src/system/angband-version.h');
    const v = (k) => Number(src.match(new RegExp(`#define H_VER_${k} (\\d+)`))[1]);
    return `${v('MAJOR')}.${v('MINOR')}.${v('PATCH')}.${v('EXTRA')}`;
}

let commit = null;
try {
    commit = execFileSync('git', ['-C', root, 'rev-parse', '--short', 'HEAD']).toString().trim();
} catch {
    commit = null;
}

const statusSrc = read('src/player/player-status-table.cpp');
const tables = {
    source: { repo: 'deskull-m/bakabakaband', commit, version: version(), extracted_at: new Date().toISOString() },
    max_level: Number(read('src/system/system-variables.h').match(/#define PY_MAX_LEVEL (\d+)/)[1]),
    player_exp: expTable(statusSrc, 'player_exp'),
    player_exp_a: expTable(statusSrc, 'player_exp_a'),
    stat: statRange(),
    // get_expfact() (src/birth/birth-stat.cpp) の特例
    expfact_rules: {
        android_race: 'ANDROID',
        speed_bonus_races: ['KLACKON', 'SPRITE'],
        speed_bonus_classes: ['MONK', 'FORCETRAINER', 'NINJA'],
        speed_bonus_penalty: 15,
    },
    races: races(),
    classes: classes(),
    dungeons: dungeons(),
};
process.stdout.write(JSON.stringify(tables, null, 2) + '\n');
