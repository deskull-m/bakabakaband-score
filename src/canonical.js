'use strict';

const crypto = require('crypto');

/*!
 * キー順序に依存しない正規化 JSON 文字列を返す。
 * 送信内容の同一判定 (content_hash) と、将来の署名検証 (#6) で共通に使う。
 */
function canonicalize(value) {
    if (Array.isArray(value)) {
        return '[' + value.map(canonicalize).join(',') + ']';
    }
    if (value && typeof value === 'object') {
        const keys = Object.keys(value).sort();
        return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonicalize(value[k])).join(',') + '}';
    }
    return JSON.stringify(value);
}

function sha256Hex(text) {
    return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

/*!
 * 送信内容のハッシュ。添付 (attachments) と submission_id は含めない。
 * 同じキャラの同じ死亡を再送した場合に、添付の有無や再送 ID が違っても同一と判定する。
 */
function contentHash(submission) {
    const { attachments, submission_id, ...rest } = submission; // eslint-disable-line no-unused-vars
    return sha256Hex(canonicalize(rest));
}

module.exports = { canonicalize, sha256Hex, contentHash };
