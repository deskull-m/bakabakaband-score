'use strict';

const path = require('path');
const crypto = require('crypto');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { ScoreStore } = require('./store');
const { validateSubmission, assessSubmission } = require('./validate');

/*!
 * 管理トークンを定数時間で比較する。
 */
function checkAdminToken(header, expected) {
    if (!expected || typeof header !== 'string' || !header.startsWith('Bearer ')) {
        return false;
    }
    const given = Buffer.from(header.slice('Bearer '.length));
    const want = Buffer.from(expected);
    return given.length === want.length && crypto.timingSafeEqual(given, want);
}

function parsePositiveInt(value, fallback, max) {
    const n = Number.parseInt(value, 10);
    if (!Number.isFinite(n) || n < 0) {
        return fallback;
    }
    return Math.min(n, max);
}

/*!
 * Express アプリを組み立てる。テストから直接使えるように listen はしない。
 * @param {Object} config loadConfig() の結果
 * @returns {{ app: import('express').Express, store: ScoreStore }}
 */
function createApp(config) {
    const app = express();
    const store = new ScoreStore(config.dbPath);

    app.disable('x-powered-by');
    if (config.trustProxy > 0) {
        app.set('trust proxy', config.trustProxy);
    }

    // 静的ページはスクリプト・スタイルを外部ファイルにしているので inline を許可しない
    app.use(helmet({
        contentSecurityPolicy: {
            directives: {
                defaultSrc: ['\'self\''],
                scriptSrc: ['\'self\''],
                styleSrc: ['\'self\''],
                imgSrc: ['\'self\'', 'data:'],
                objectSrc: ['\'none\''],
                frameAncestors: ['\'none\''],
            },
        },
    }));

    const readCors = cors({ origin: config.corsOrigin, methods: ['GET'] });
    const adminAuth = (req, res, next) => {
        if (!config.adminToken) {
            return res.status(503).json({ error: 'admin operations are disabled (ADMIN_TOKEN not set)' });
        }
        if (!checkAdminToken(req.get('authorization'), config.adminToken)) {
            return res.status(401).json({ error: 'unauthorized' });
        }
        return next();
    };

    const submitLimiter = config.disableRateLimit
        ? (req, res, next) => next()
        : rateLimit({
            windowMs: config.submitRateWindowMs,
            limit: config.submitRateMax,
            standardHeaders: 'draft-7',
            legacyHeaders: false,
            message: { error: 'too many submissions, try again later' },
        });

    // --- 静的ページ ---------------------------------------------------------
    const publicDir = path.join(__dirname, '..', 'public');
    app.use(express.static(publicDir, { index: 'index.html' }));
    app.get('/leaderboard', (req, res) => {
        res.sendFile(path.join(publicDir, 'leaderboard.html'));
    });

    // --- スコア登録 ---------------------------------------------------------
    app.post('/submit', submitLimiter, express.json({ limit: config.bodyLimit, strict: true }), (req, res) => {
        const result = validateSubmission(req.body);
        if (!result.ok) {
            return res.status(400).json({ error: `invalid submission: ${result.error}` });
        }
        const assessment = assessSubmission(result.submission, result.legacy);
        const { id, rank } = store.insert(result.submission, assessment);
        // ゲーム側は HTTP 200 のみを成功と見なすので 201 ではなく 200 を返す
        return res.status(200).json({
            success: true,
            id,
            rank,
            points: assessment.pointsComputed !== null ? assessment.pointsComputed : result.submission.score.points,
            flags: assessment.flags,
        });
    });

    // --- 読み取り API -------------------------------------------------------
    app.get('/scores', readCors, (req, res) => {
        const limit = parsePositiveInt(req.query.limit, 100, config.maxPageSize) || config.maxPageSize;
        const offset = parsePositiveInt(req.query.offset, 0, Number.MAX_SAFE_INTEGER);
        res.json({
            total: store.count(),
            limit,
            offset,
            scores: store.list({ limit, offset }),
        });
    });

    app.get('/scores/:id', readCors, (req, res) => {
        const entry = store.get(req.params.id);
        if (!entry) {
            return res.status(404).json({ error: 'score not found' });
        }
        return res.json(entry);
    });

    // --- 管理操作 -----------------------------------------------------------
    app.delete('/scores/:id', adminAuth, (req, res) => {
        if (!store.delete(req.params.id)) {
            return res.status(404).json({ error: 'score not found' });
        }
        return res.json({ success: true });
    });

    app.post('/scores/:id/verify', adminAuth, express.json({ limit: '1kb' }), (req, res) => {
        const verified = req.body && req.body.verified !== false;
        if (!store.setVerified(req.params.id, verified)) {
            return res.status(404).json({ error: 'score not found' });
        }
        return res.json({ success: true, verified });
    });

    // --- エラー処理 ---------------------------------------------------------
    app.use((req, res) => {
        res.status(404).json({ error: 'not found' });
    });
    // eslint-disable-next-line no-unused-vars
    app.use((err, req, res, next) => {
        if (err.type === 'entity.parse.failed') {
            return res.status(400).json({ error: 'malformed JSON' });
        }
        if (err.type === 'entity.too.large') {
            return res.status(413).json({ error: 'payload too large' });
        }
        console.error(err);
        return res.status(500).json({ error: 'internal server error' });
    });

    return { app, store };
}

module.exports = { createApp, checkAdminToken };
