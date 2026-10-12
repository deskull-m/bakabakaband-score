'use strict';

const path = require('path');

/*!
 * 環境変数から設定を読み込む。
 * すべて省略可能で、省略時は開発用の安全側デフォルトになる。
 */
function loadConfig(env = process.env) {
    const dataDir = env.DATA_DIR || path.join(__dirname, '..', 'data');
    return {
        port: Number(env.PORT) || 3000,
        // SQLite ファイルのパス。':memory:' でインメモリ (テスト用)
        dbPath: env.SCORES_DB || path.join(dataDir, 'scores.sqlite'),
        // 管理操作 (DELETE 等) 用の Bearer トークン。未設定なら管理操作は無効
        adminToken: env.ADMIN_TOKEN || '',
        // リバースプロキシ配下で X-Forwarded-For を信用する段数 (0 で無効)
        trustProxy: Number(env.TRUST_PROXY) || 0,
        // クライアント IP を取るヘッダ (例: CF-Connecting-IP)。前段以外からの直接接続を塞いでいる場合のみ設定する
        clientIpHeader: env.CLIENT_IP_HEADER || '',
        // 読み取り API に付与する CORS の Origin。公開データなので既定は '*'
        corsOrigin: env.CORS_ORIGIN || '*',
        // 受け付ける POST ボディの上限
        bodyLimit: env.BODY_LIMIT || '512kb',
        // /submit のレート制限 (IP ごと、ウィンドウ内の回数)
        submitRateWindowMs: Number(env.SUBMIT_RATE_WINDOW_MS) || 10 * 60 * 1000,
        submitRateMax: Number(env.SUBMIT_RATE_MAX) || 10,
        // 読み取り API / ページのレート制限 (IP ごと、ウィンドウ内の回数)
        readRateWindowMs: Number(env.READ_RATE_WINDOW_MS) || 60 * 1000,
        readRateMax: Number(env.READ_RATE_MAX) || 120,
        // レート制限を無効化する (テスト用)
        disableRateLimit: env.DISABLE_RATE_LIMIT === '1',
        // 全体での日次受付上限 (0 で無効)
        submitDailyMax: env.SUBMIT_DAILY_MAX !== undefined ? Number(env.SUBMIT_DAILY_MAX) : 500,
        // ディスク空き容量がこれを切ったら /submit を停止する (MB、0 で無効)
        minFreeDiskMb: env.MIN_FREE_DISK_MB !== undefined ? Number(env.MIN_FREE_DISK_MB) : 1024,
        // 統計ログの出力間隔 (ms、0 で無効)
        statsIntervalMs: env.STATS_INTERVAL_MS !== undefined ? Number(env.STATS_INTERVAL_MS) : 60 * 60 * 1000,
        // 一覧 API の 1 ページ最大件数
        maxPageSize: Number(env.MAX_PAGE_SIZE) || 200,
        // 疑わしさの合計がこれ以上の未検証の記録は、既定のランキング表示から外す (0 で無効)
        suspicionHideThreshold: env.SUSPICION_HIDE_THRESHOLD !== undefined ? Number(env.SUSPICION_HIDE_THRESHOLD) : 3,
        // レベル 1 上げるのに最低限かかるはずの実ターン数。下回ると level_too_fast (0 で無効)
        minTurnsPerLevel: Number(env.MIN_TURNS_PER_LEVEL) || 0,
    };
}

module.exports = { loadConfig };
