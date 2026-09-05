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
        // 読み取り API に付与する CORS の Origin。公開データなので既定は '*'
        corsOrigin: env.CORS_ORIGIN || '*',
        // 受け付ける POST ボディの上限
        bodyLimit: env.BODY_LIMIT || '512kb',
        // /submit のレート制限 (IP ごと、ウィンドウ内の回数)
        submitRateWindowMs: Number(env.SUBMIT_RATE_WINDOW_MS) || 10 * 60 * 1000,
        submitRateMax: Number(env.SUBMIT_RATE_MAX) || 10,
        // レート制限を無効化する (テスト用)
        disableRateLimit: env.DISABLE_RATE_LIMIT === '1',
        // 一覧 API の 1 ページ最大件数
        maxPageSize: Number(env.MAX_PAGE_SIZE) || 200,
    };
}

module.exports = { loadConfig };
