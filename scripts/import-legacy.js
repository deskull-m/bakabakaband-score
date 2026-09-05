'use strict';

/*!
 * 旧サーバの scores.json (配列) を SQLite に取り込む。
 * 使い方: node scripts/import-legacy.js path/to/scores.json
 */
const fs = require('fs');
const { loadConfig } = require('../src/config');
const { ScoreStore } = require('../src/store');
const { validateSubmission, assessSubmission } = require('../src/validate');

const file = process.argv[2];
if (!file) {
    console.error('usage: node scripts/import-legacy.js scores.json');
    process.exit(1);
}

const entries = JSON.parse(fs.readFileSync(file, 'utf8'));
const store = new ScoreStore(loadConfig().dbPath);
let imported = 0;
let skipped = 0;
for (const entry of entries) {
    const result = validateSubmission(entry.dump || entry);
    if (!result.ok) {
        skipped += 1;
        console.warn(`skip ${entry.id || '?'}: ${result.error}`);
        continue;
    }
    store.insert(result.submission, assessSubmission(result.submission, result.legacy));
    imported += 1;
}
store.close();
console.log(`imported ${imported}, skipped ${skipped}`);
