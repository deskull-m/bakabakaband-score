'use strict';

const fs = require('fs');
const path = require('path');
const { rateLimit, ipKeyGenerator } = require('express-rate-limit');

/*!
 * 要求元のクライアント IP を返す。
 * CLIENT_IP_HEADER (例: CF-Connecting-IP) が設定されていればそのヘッダを優先する。
 * このヘッダは前段 (Cloudflare) 以外からの直接接続を塞いでいる前提でしか信用できない。
 */
function clientIp(req, config) {
    if (config.clientIpHeader) {
        const v = req.get(config.clientIpHeader);
        if (v) {
            return v.trim();
        }
    }
    return req.ip || '';
}

/*!
 * レート制限のキー。IPv6 は /64 プレフィックス単位で数える。
 */
function rateLimitKey(ip) {
    return ipKeyGenerator(ip, 64);
}

function makeLimiter(config, { windowMs, limit, message }) {
    if (config.disableRateLimit) {
        return (req, res, next) => next();
    }
    return rateLimit({
        windowMs,
        limit,
        standardHeaders: 'draft-7',
        legacyHeaders: false,
        keyGenerator: (req) => rateLimitKey(clientIp(req, config)),
        // ipv6Subnet は keyGenerator 側で処理しているので検証を抑止する
        validate: { ipv6Subnet: false, keyGeneratorIpFallback: false, xForwardedForHeader: false },
        message: { error: message },
    });
}

/*!
 * ディスク空き容量 (MB)。取得できない環境では null。
 */
function freeDiskMb(dbPath) {
    if (dbPath === ':memory:') {
        return null;
    }
    try {
        const s = fs.statfsSync(path.dirname(dbPath));
        return Math.floor((s.bavail * s.bsize) / (1024 * 1024));
    } catch {
        return null;
    }
}

/*!
 * /submit の前段で、保存量の安全弁を掛けるミドルウェアを作る。
 * - 日次受付上限 (SUBMIT_DAILY_MAX) を超えたら 503
 * - ディスク空き容量 (MIN_FREE_DISK_MB) を切ったら 503
 * 閲覧は影響を受けない。どちらもボディを読む前に判定する。
 */
function makeCapacityGuard(config, store, stats) {
    let lastDiskCheck = 0;
    let lastFree = null;
    return (req, res, next) => {
        if (config.submitDailyMax > 0 && store.countSince(startOfUtcDay()) >= config.submitDailyMax) {
            stats.capacity_rejected += 1;
            return res.status(503).json({ error: 'daily submission limit reached, try again tomorrow' });
        }
        if (config.minFreeDiskMb > 0) {
            const now = Date.now();
            if (now - lastDiskCheck > 10000) {
                lastFree = freeDiskMb(config.dbPath);
                lastDiskCheck = now;
            }
            if (lastFree !== null && lastFree < config.minFreeDiskMb) {
                stats.capacity_rejected += 1;
                return res.status(503).json({ error: 'server storage is low, submissions are paused' });
            }
        }
        return next();
    };
}

function startOfUtcDay(now = new Date()) {
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
}

/*!
 * TRUST_PROXY 未設定でプロキシ経由らしい要求を受けたら一度だけ警告する。
 * この状態ではすべての要求が同じ IP に見え、正規プレイヤーがレート制限で締め出される。
 */
function makeProxyWarning(config, log = console.warn) {
    let warned = false;
    return (req, res, next) => {
        if (!warned && !config.trustProxy && !config.clientIpHeader
            && (req.get('cf-connecting-ip') || req.get('x-forwarded-for'))) {
            warned = true;
            log('[warn] proxy headers detected but TRUST_PROXY / CLIENT_IP_HEADER is not set: '
                + 'all clients will share one rate-limit bucket. See deploy/cloudflare.md');
        }
        next();
    };
}

function newStats() {
    return {
        since: new Date().toISOString(),
        accepted: 0,
        duplicates: 0,
        flagged: 0,
        rejected: 0,
        rate_limited: 0,
        capacity_rejected: 0,
    };
}

module.exports = { clientIp, rateLimitKey, makeLimiter, makeCapacityGuard, makeProxyWarning, freeDiskMb, newStats, startOfUtcDay };
