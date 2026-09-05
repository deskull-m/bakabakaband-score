'use strict';

const { loadConfig } = require('./src/config');
const { createApp } = require('./src/app');

const config = loadConfig();
const { app, store } = createApp(config);

const server = app.listen(config.port, () => {
    console.log(`Bakabakaband Score Server listening on http://localhost:${config.port}`);
    console.log(`  database: ${config.dbPath}`);
    console.log(`  admin operations: ${config.adminToken ? 'enabled' : 'disabled (set ADMIN_TOKEN)'}`);
});

function shutdown() {
    server.close(() => {
        store.close();
        process.exit(0);
    });
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
