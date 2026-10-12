'use strict';

/*!
 * ゲーム本体の定数表 (src/data/game-tables.json) を使った妥当性チェック。
 * ここでの判定はすべて「拒否」ではなく「フラグ」で、重み付けして疑わしさの点数にする。
 */
const tables = require('./data/game-tables.json');

const byTitle = (rows) => {
    const m = new Map();
    for (const r of rows) {
        m.set(r.ja, r);
        m.set(r.en, r);
    }
    return m;
};
const RACES = byTitle(tables.races);
const CLASSES = byTitle(tables.classes);
const DUNGEONS = (() => {
    const m = new Map();
    for (const d of tables.dungeons) {
        for (const k of [d.tag, d.ja, d.en, String(d.id)]) {
            m.set(k, d);
        }
    }
    return m;
})();
const MAX_DUNGEON_DEPTH = Math.max(...tables.dungeons.map((d) => d.max_depth));

// ゲームのバージョン文字列 (AngbandVersion::build_expression FULL / WITH_EXTRA / WITHOUT_EXTRA)
const VERSION_RE = /^(?:(?:馬鹿馬鹿蛮怒|Bakabakaband) )?\d+\.\d+\.\d+(?:\.\d+)?(?:\([^)]*\)|-[\w.-]+)?$/u;

/*!
 * 各フラグの重み。合計が閾値以上の記録は既定のランキング表示から外す。
 * 3 以上: 単独で「ゲームの仕様上あり得ない」もの
 * 2: 不正の兆候だが正規の記録でも起こりうるもの
 * 1: 情報不足や未知の値
 */
const FLAG_WEIGHTS = {
    level_out_of_range: 3,
    level_exceeds_max_level: 3,
    exp_exceeds_max: 3,
    depth_exceeds_max: 3,
    depth_exceeds_dungeon_max: 3,
    level_exp_mismatch: 3,
    stat_out_of_range: 3,
    winner_flags_inconsistent: 2,
    zero_turns: 2,
    level_too_fast: 2,
    score_mismatch: 1,
    unknown_race: 1,
    unknown_class: 1,
    unknown_version: 1,
    not_dead: 1,
    score_not_recomputable: 1,
    legacy_format: 0,
};

function suspicionOf(flags) {
    return flags.reduce((sum, f) => sum + (FLAG_WEIGHTS[f] ?? 1), 0);
}

/*!
 * get_expfact() (src/birth/birth-stat.cpp) の移植。
 */
function expFactor(race, cls) {
    const rules = tables.expfact_rules;
    let f = race.exp;
    if (race.tag !== rules.android_race) {
        f += cls.exp;
    }
    if (rules.speed_bonus_races.includes(race.tag) && rules.speed_bonus_classes.includes(cls.tag)) {
        f -= rules.speed_bonus_penalty;
    }
    return f;
}

/*!
 * 経験値から導かれるレベル (check_experience() の移植)。
 */
function levelForExp(exp, race, cls) {
    const table = race.tag === tables.expfact_rules.android_race ? tables.player_exp_a : tables.player_exp;
    const factor = expFactor(race, cls);
    let level = 1;
    while (level < tables.max_level && exp >= Math.floor((table[level - 1] * factor) / 100)) {
        level += 1;
    }
    return level;
}

/*!
 * 定数表に基づく妥当性チェック。flags に追加する。
 * @param {string[]} flags
 * @param {Object} submission 検証済み envelope
 * @param {{ minTurnsPerLevel: number }} opts
 */
function checkPlausibility(flags, submission, opts = {}) {
    const c = submission.character;
    const basic = c.basic || {};
    const progress = submission.progress || {};
    const game = submission.game || {};

    const race = basic.race ? RACES.get(basic.race) : undefined;
    const cls = basic.class ? CLASSES.get(basic.class) : undefined;
    if (basic.race && !race) {
        flags.push('unknown_race');
    }
    if (basic.class && !cls) {
        flags.push('unknown_class');
    }
    if (race && cls && typeof basic.experience === 'number' && typeof basic.level === 'number') {
        const expected = levelForExp(basic.experience, race, cls);
        if (expected !== basic.level) {
            flags.push('level_exp_mismatch');
        }
    }

    if (game.version && game.version !== 'unknown' && !VERSION_RE.test(game.version)) {
        flags.push('unknown_version');
    }

    if (progress.true_winner && !progress.total_winner) {
        flags.push('winner_flags_inconsistent');
    }

    for (const s of c.stats || []) {
        for (const k of ['current', 'max', 'use', 'top']) {
            if (typeof s[k] === 'number' && (s[k] < 0 || s[k] > tables.stat.max)) {
                flags.push('stat_out_of_range');
                break;
            }
        }
        if (flags[flags.length - 1] === 'stat_out_of_range') {
            break;
        }
    }

    let depthExceeded = typeof progress.max_depth_overall === 'number' && progress.max_depth_overall > MAX_DUNGEON_DEPTH;
    for (const [key, depth] of Object.entries(progress.max_depth || {})) {
        const d = DUNGEONS.get(key);
        if (d && depth > d.max_depth) {
            depthExceeded = true;
        }
    }
    if (depthExceeded) {
        flags.push('depth_exceeds_dungeon_max');
    }

    const minTurnsPerLevel = opts.minTurnsPerLevel || 0;
    if (minTurnsPerLevel > 0 && typeof progress.real_turns === 'number' && progress.max_level > 1
        && progress.real_turns < (progress.max_level - 1) * minTurnsPerLevel) {
        flags.push('level_too_fast');
    }
}

module.exports = { checkPlausibility, suspicionOf, levelForExp, expFactor, FLAG_WEIGHTS, VERSION_RE, tables };
