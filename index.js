'use strict';

const { loadConfig } = require('./src/config');
const { createApp } = require('./src/app');

const config = loadConfig();
const { app, store, stats } = createApp(config);

const server = app.listen(config.port, () => {
    console.log(`Bakabakaband Score Server listening on http://localhost:${config.port}`);
    console.log(`  database: ${config.dbPath}`);
    console.log(`  admin operations: ${config.adminToken ? 'enabled' : 'disabled (set ADMIN_TOKEN)'}`);
    console.log(`  trust proxy: ${config.trustProxy}, client ip header: ${config.clientIpHeader || '(none)'}`);
});

// 遅い接続を大量に張られても資源を握り続けないよう、接続タイムアウトを短めにする
server.headersTimeout = 15 * 1000;
server.requestTimeout = 30 * 1000;
server.keepAliveTimeout = 5 * 1000;

let statsTimer = null;
if (config.statsIntervalMs > 0) {
    statsTimer = setInterval(() => {
        console.log('[stats] ' + JSON.stringify(Object.assign({ total: store.count() }, stats)));
    }, config.statsIntervalMs);
    statsTimer.unref();
}

function shutdown() {
    if (statsTimer) {
        clearInterval(statsTimer);
    }
    server.close(() => {
        store.close();
        process.exit(0);
    });
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
