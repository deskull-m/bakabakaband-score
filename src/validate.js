'use strict';

const Ajv = require('ajv');
const addFormats = require('ajv-formats');
const schema = require('../schema/ScoreSubmission.schema.json');
const { recomputeFromSubmission } = require('./score');

const ajv = new Ajv({ allErrors: false, strict: false });
addFormats(ajv);
const validateEnvelope = ajv.compile(schema);
const validateCreature = ajv.compile({
    $ref: `${schema.$id}#/definitions/creatureStatus`,
});

const LEGACY_FORMAT = 'bakabakaband-creature-status';
const ENVELOPE_FORMAT = 'bakabakaband-score-submission';

/*!
 * 旧形式 (dump_player_status_json() の素の出力) を envelope 形式に包む。
 * 旧形式にはスコアやターン数が無いので、経験値をスコア代わりにする。
 */
function wrapLegacy(dump) {
    const basic = dump.basic || {};
    const status = dump.status || {};
    const death = dump.death || {};
    return {
        format: ENVELOPE_FORMAT,
        format_version: 1,
        game: { version: 'unknown' },
        score: { points: Math.max(0, basic.max_experience || basic.experience || 0) },
        progress: {
            max_level: basic.level || 1,
            real_turns: Math.max(0, status.game_turn || 0),
            max_depth_overall: status.max_dungeon_level || 0,
            total_winner: Boolean(death.is_winner),
            true_winner: Boolean(death.is_winner),
        },
        character: dump,
    };
}

function formatError(errors) {
    const e = (errors || [])[0];
    if (!e) {
        return 'invalid submission';
    }
    return `${e.instancePath || '/'} ${e.message}`;
}

/*!
 * 送信データを検証し、正規化した envelope とスキーマエラーを返す。
 * @returns {{ ok: boolean, error?: string, submission?: Object, legacy?: boolean }}
 */
function validateSubmission(body) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
        return { ok: false, error: 'body must be a JSON object' };
    }

    if (body.format === ENVELOPE_FORMAT) {
        if (!validateEnvelope(body)) {
            return { ok: false, error: formatError(validateEnvelope.errors) };
        }
        return { ok: true, submission: body, legacy: false };
    }

    if (body.version && body.version.format === LEGACY_FORMAT) {
        if (!validateCreature(body)) {
            return { ok: false, error: formatError(validateCreature.errors) };
        }
        return { ok: true, submission: wrapLegacy(body), legacy: true };
    }

    return { ok: false, error: `unknown format (expected ${ENVELOPE_FORMAT})` };
}

/*!
 * 妥当性チェック。拒否はせず、怪しい点を flags として列挙する。
 * 拒否すると送信者に境界を教えるだけなので、受け付けてから隔離する方針。
 * @returns {{ flags: string[], pointsComputed: number|null }}
 */
function assessSubmission(submission, legacy) {
    const flags = [];
    const c = submission.character;
    const basic = c.basic || {};
    const status = c.status || {};
    const death = c.death || {};
    const progress = submission.progress;

    if (legacy) {
        flags.push('legacy_format');
    }
    if (basic.level > 50 || progress.max_level > 50) {
        flags.push('level_out_of_range');
    }
    if (basic.level > progress.max_level) {
        flags.push('level_exceeds_max_level');
    }
    if (typeof basic.experience === 'number' && typeof basic.max_experience === 'number'
        && basic.experience > basic.max_experience) {
        flags.push('exp_exceeds_max');
    }
    if (typeof status.dungeon_level === 'number' && typeof status.max_dungeon_level === 'number'
        && status.dungeon_level > status.max_dungeon_level) {
        flags.push('depth_exceeds_max');
    }
    if (progress.real_turns === 0 && basic.level > 1) {
        flags.push('zero_turns');
    }
    if (!death.is_dead && !death.is_winner) {
        flags.push('not_dead');
    }

    const pointsComputed = recomputeFromSubmission(submission);
    if (pointsComputed === null) {
        flags.push('score_not_recomputable');
    } else if (pointsComputed !== submission.score.points) {
        flags.push('score_mismatch');
    }

    return { flags, pointsComputed };
}

module.exports = { validateSubmission, assessSubmission, ENVELOPE_FORMAT, LEGACY_FORMAT };
