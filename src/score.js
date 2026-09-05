'use strict';

/*!
 * ゲーム側 calc_score() (src/player/player-status.cpp) の移植。
 * クライアント申告のスコアをそのまま信用せず、申告された入力から
 * サーバ側でも同じ式で再計算し、乖離があれば検出するために使う。
 *
 * すべての演算は元コードに合わせて 32bit 符号なし整数で行う。
 */

const U32 = 0xFFFFFFFFn;

/*!
 * オプション群から乗数を求める (calc_score() 前半)。
 * @param {Object<string, boolean>} options
 * @returns {number}
 */
function computeMultiplier(options) {
    const o = options || {};
    let mult = 100;
    if (!o.preserve_mode) {
        mult += 10;
    }
    if (!o.autoroller) {
        mult += 10;
    }
    if (!o.smart_learn) {
        mult -= 20;
    }
    if (o.smart_cheat) {
        mult += 30;
    }
    if (o.ironman_shops) {
        mult += 50;
    }
    if (o.ironman_smallest_floor) {
        mult += 10;
    }
    if (o.ironman_force_arena_floor) {
        mult += 20;
    }
    if (!o.powerup_home) {
        mult += 50;
    }
    if (o.ironman_rooms) {
        mult += 100;
    }
    if (o.ironman_nightmare) {
        mult += 100;
    }
    if (mult < 5) {
        mult = 5;
    }
    return mult;
}

/*!
 * スコアを再計算する。
 * @param {Object} input
 * @param {number} input.maxMaxExp        生涯最大経験値 (get_max_max_exp)
 * @param {number} input.maxDepthOverall  全ダンジョン中の最深到達階
 * @param {number} input.multiplier       乗数 (computeMultiplier の結果)
 * @param {number} [input.arenaWins]      闘技場勝利数。負数なら闘技場不参加扱い
 * @param {boolean} [input.ironmanDownward]
 * @param {boolean} [input.spectreBerserker]  幽霊×狂戦士
 * @param {number} [input.deathCount]
 * @param {boolean} [input.munchkin]
 * @param {boolean} [input.totalWinner]
 * @returns {number} 32bit 符号なし整数のスコア
 */
function computeScore(input) {
    const mult = BigInt(input.multiplier);
    const base = (BigInt(input.maxMaxExp) + 100n * BigInt(input.maxDepthOverall)) & U32;
    let pointH = base / 0x10000n;
    let pointL = base % 0x10000n;
    pointH *= mult;
    pointL *= mult;
    pointH += pointL / 0x10000n;
    pointL %= 0x10000n;
    pointL += (pointH % 100n) << 16n;
    pointH /= 100n;
    pointL /= 100n;

    let point = ((pointH << 16n) + pointL) & U32;

    const arenaWins = input.arenaWins;
    if (typeof arenaWins === 'number' && arenaWins >= 0) {
        const w = BigInt(arenaWins);
        point = (point + w * w * (arenaWins > 29 ? 1000n : 100n)) & U32;
    }
    if (input.ironmanDownward) {
        point = (point * 2n) & U32;
    }
    if (input.spectreBerserker) {
        point /= 5n;
    }
    const deathCount = input.deathCount || 0;
    if (deathCount > 0) {
        point /= BigInt(deathCount) + 1n;
    }
    if (input.munchkin && point !== 0n) {
        point = input.totalWinner ? 2n : 1n;
    }
    return Number(point);
}

/*!
 * 送信データからスコアを再計算する。必要な入力が欠けていれば null。
 * @param {Object} submission 検証済みの送信データ (envelope 形式)
 * @returns {number|null}
 */
function recomputeFromSubmission(submission) {
    const score = submission.score || {};
    const progress = submission.progress || {};
    if (!score.options || typeof progress.max_max_experience !== 'number') {
        return null;
    }
    const maxDepthOverall = typeof progress.max_depth_overall === 'number'
        ? progress.max_depth_overall
        : Math.max(0, ...Object.values(progress.max_depth || {}));

    return computeScore({
        maxMaxExp: progress.max_max_experience,
        maxDepthOverall,
        multiplier: computeMultiplier(score.options),
        arenaWins: score.arena_wins,
        ironmanDownward: Boolean(score.options.ironman_downward),
        spectreBerserker: Boolean(score.spectre_berserker),
        deathCount: progress.death_count,
        munchkin: Boolean(score.munchkin),
        totalWinner: Boolean(progress.total_winner),
    });
}

module.exports = { computeMultiplier, computeScore, recomputeFromSubmission };
