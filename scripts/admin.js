#!/usr/bin/env node
'use strict';

/*!
 * 管理操作 CLI。サーバの管理 API を ADMIN_TOKEN で叩く。
 *
 *   SCORE_SERVER_URL=https://score.example.net ADMIN_TOKEN=... node scripts/admin.js <command> [args]
 *
 * コマンド:
 *   list-flagged [limit]        要確認 (フラグ付きで未検証) の記録を一覧
 *   show <id>                   記録の詳細 (削除済みも含む)
 *   verify <id> [reason]        検証済みにする
 *   unverify <id> [reason]      検証済みを外す
 *   delete <id> [reason]        論理削除 (restore で戻せる)
 *   restore <id> [reason]       論理削除を取り消す
 *   purge <id> [reason]         物理削除 (添付ごと消える。再送が通るようになる)
 *   log [limit]                 監査ログ
 */

const base = (process.env.SCORE_SERVER_URL || 'http://localhost:3000').replace(/\/$/, '');
const token = process.env.ADMIN_TOKEN;

async function call(method, path, { body, reason } = {}) {
    const headers = { Authorization: `Bearer ${token}` };
    if (reason) {
        headers['X-Admin-Reason'] = reason;
    }
    if (body !== undefined) {
        headers['Content-Type'] = 'application/json';
    }
    const res = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    let data;
    try {
        data = JSON.parse(text);
    } catch {
        data = { raw: text };
    }
    if (!res.ok) {
        throw new Error(`${method} ${path} -> ${res.status}: ${data.error || text}`);
    }
    return data;
}

function fmtRow(s) {
    const badges = [s.verified ? 'verified' : null, s.flags.length ? `flags=${s.flags.join(',')}` : null].filter(Boolean).join(' ');
    return `${s.id}  ${s.created_at}  ${String(s.points).padStart(10)}  Lv${String(s.level).padStart(3)}  ${s.name} (${s.race || '-'}/${s.class || '-'})  ${badges}`;
}

const commands = {
    async 'list-flagged'(limit = '50') {
        const data = await call('GET', `/scores?flagged=1&limit=${encodeURIComponent(limit)}`);
        console.log(`${data.total} flagged record(s)`);
        for (const s of data.scores) {
            console.log(fmtRow(s));
        }
    },
    async show(id) {
        console.log(JSON.stringify(await call('GET', `/admin/scores/${encodeURIComponent(id)}`), null, 2));
    },
    async verify(id, reason) {
        console.log(await call('POST', `/scores/${encodeURIComponent(id)}/verify`, { body: { verified: true }, reason }));
    },
    async unverify(id, reason) {
        console.log(await call('POST', `/scores/${encodeURIComponent(id)}/verify`, { body: { verified: false }, reason }));
    },
    async delete(id, reason) {
        console.log(await call('DELETE', `/scores/${encodeURIComponent(id)}`, { reason }));
    },
    async restore(id, reason) {
        console.log(await call('POST', `/scores/${encodeURIComponent(id)}/restore`, { reason }));
    },
    async purge(id, reason) {
        console.log(await call('DELETE', `/scores/${encodeURIComponent(id)}?purge=1`, { reason }));
    },
    async log(limit = '50') {
        const data = await call('GET', `/admin/log?limit=${encodeURIComponent(limit)}`);
        for (const e of data.log) {
            console.log(`${e.at}  ${e.action.padEnd(8)}  ${e.score_id || '-'}  ${e.detail || ''}`);
        }
    },
};

async function main() {
    const [cmd, ...args] = process.argv.slice(2);
    if (!cmd || !commands[cmd]) {
        console.error(`usage: admin.js <${Object.keys(commands).join('|')}> [args]`);
        process.exit(2);
    }
    if (!token) {
        console.error('ADMIN_TOKEN is not set');
        process.exit(2);
    }
    if (['show', 'verify', 'unverify', 'delete', 'restore', 'purge'].includes(cmd) && !args[0]) {
        console.error(`usage: admin.js ${cmd} <id> [reason]`);
        process.exit(2);
    }
    await commands[cmd](...args);
}

main().catch((err) => {
    console.error(err.message);
    process.exit(1);
});
