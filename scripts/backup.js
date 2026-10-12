'use strict';

/*!
 * SQLite のオンラインバックアップを取る。WAL モードでも整合した 1 ファイルになる。
 * 使い方: node scripts/backup.js [出力先ディレクトリ]   (既定: <DATA_DIR>/backups)
 * 環境変数 BACKUP_KEEP (既定 14) 世代より古いものは削除する。
 */
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { loadConfig } = require('../src/config');

async function main() {
    const config = loadConfig();
    if (config.dbPath === ':memory:') {
        throw new Error('SCORES_DB is :memory:, nothing to back up');
    }
    const outDir = process.argv[2] || path.join(path.dirname(config.dbPath), 'backups');
    const keep = Number(process.env.BACKUP_KEEP) || 14;
    fs.mkdirSync(outDir, { recursive: true });

    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const dest = path.join(outDir, `scores-${stamp}.sqlite`);
    const db = new Database(config.dbPath, { readonly: true });
    try {
        await db.backup(dest);
    } finally {
        db.close();
    }
    console.log(`backup written: ${dest}`);

    const old = fs.readdirSync(outDir)
        .filter((f) => /^scores-.*\.sqlite$/.test(f))
        .sort()
        .slice(0, -keep);
    for (const f of old) {
        fs.unlinkSync(path.join(outDir, f));
        console.log(`removed old backup: ${f}`);
    }
}

main().catch((err) => {
    console.error(err.message);
    process.exit(1);
});
