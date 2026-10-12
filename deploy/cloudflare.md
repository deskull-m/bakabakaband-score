# Cloudflare を前段に置く手順

スコアサーバは volumetric な DDoS や接続レベルの攻撃をアプリ側では防げない。
Cloudflare (無料プランで足りる) を前段に置き、オリジンには「通ったものが資源を食い潰さない」安全弁だけを残す。

## 1. DNS とプロキシ

1. ドメインを Cloudflare に追加し、ネームサーバを切り替える
2. スコアサーバ用の A / AAAA レコードを作り、**Proxy status を Proxied (オレンジ雲)** にする
3. この時点で `https://score.example.net/` が Cloudflare 経由で開けることを確認する

## 2. TLS

1. SSL/TLS → Overview で **Full (strict)** を選ぶ
2. SSL/TLS → Origin Server → Create Certificate で **Origin CA 証明書** を発行し、オリジン側の Caddy / nginx に設定する
   (Caddy の例は `deploy/Caddyfile` を参照。Let's Encrypt でも構わないが、Origin CA なら 15 年有効で更新不要)
3. Edge Certificates で **Always Use HTTPS** と **Minimum TLS Version 1.2** を有効にする

## 3. オリジンの直叩きを塞ぐ (必須)

これをやらないと、攻撃者はオリジンの IP を直接叩いて Cloudflare を素通りできる。

- オリジンのファイアウォールで、443 を **Cloudflare の IP レンジ** (https://www.cloudflare.com/ips/) からだけ許可する
- ufw の例:

  ```sh
  for ip in $(curl -s https://www.cloudflare.com/ips-v4) $(curl -s https://www.cloudflare.com/ips-v6); do
      ufw allow proto tcp from "$ip" to any port 443
  done
  ufw deny 443
  ```

- IP レンジは変わることがあるので、月に一度程度は更新する (cron で上記を流し直す)
- 代わりに **Cloudflare Tunnel (cloudflared)** を使えば、オリジンは inbound ポートを一切開けずに済む。練習ならこちらも試す価値がある

## 4. 実クライアント IP をアプリに渡す

Cloudflare 経由の要求は、オリジンから見ると送信元がすべて Cloudflare の IP になる。
そのままではアプリのレート制限が「全員同じ IP」と見なし、正規プレイヤーを締め出す。

- アプリの環境変数に **`CLIENT_IP_HEADER=CF-Connecting-IP`** を設定する
- 合わせて `TRUST_PROXY=1` も設定する (Express が `req.ip` を正しく解釈するため)
- 手順 3 でオリジンを塞いでいない状態で `CLIENT_IP_HEADER` を設定すると、ヘッダを偽装してレート制限を回避できるので、**必ず 3 を先に**やる
- 設定し忘れると、アプリは起動後最初のプロキシ経由要求で `[warn] proxy headers detected but TRUST_PROXY / CLIENT_IP_HEADER is not set` を出す

## 5. WAF のレート制限

Security → WAF → Rate limiting rules で次を作る。アプリ側の制限と二重でよい (Cloudflare の方が手前で止める)。

| ルール | 条件 | 制限 | 超過時 |
|---|---|---|---|
| submit | `http.request.method eq "POST" and http.request.uri.path eq "/submit"` | 同一 IP から 10 分に 10 回 | Block 10 分 |
| read | `http.request.uri.path matches "^/scores"` | 同一 IP から 1 分に 60 回 | Block 1 分 |

無料プランのレート制限はカウント期間が 10 秒固定の場合がある。その場合は「10 秒に 3 回」など期間に合わせて換算する。

## 6. ボット対策で守ってはいけない場所

ゲームクライアントは libcurl (または Godot の HTTPRequest) で `/submit` を叩く。**JavaScript チャレンジは解けない**。

- Security → Bots → **Bot Fight Mode** は有効にしてよいが、`/submit` が弾かれないか実機で送信して確認する。弾かれる場合は WAF カスタムルールで `/submit` への POST を Skip (Bot Fight Mode を除外) する
- **Under Attack Mode** を有効にすると `/submit` は全滅する。緊急時の手順は次の通り:
  1. WAF カスタムルールで `/submit` への POST を **一時的に Block** し、閲覧だけ残す
  2. 収まったらルールを無効化する
  3. この間にゲーム側から送信したプレイヤーは「後でスコアを登録するために待機」を選べば再送できる (#9 の `submission_id` で重複しない)

## 7. エッジキャッシュ

Caching → Cache Rules で、閲覧系をエッジでキャッシュするとオリジンにはほとんど届かなくなる。

| 対象 | Edge TTL |
|---|---|
| `/scores` (クエリ付き含む) | 30 秒 |
| `/scores/*` | 5 分 |
| `/leaderboard`, `/`, `*.css`, `*.js` | 1 時間 |

- `POST /submit` と `DELETE`, `/scores/*/verify` はキャッシュ対象にしないこと (メソッドが GET 以外なら既定で対象外)
- 削除や検証済みマークがすぐ反映されなくてよいなら TTL はもっと長くできる

## 8. 確認

- `curl -sI https://score.example.net/scores | grep -i cf-cache-status` で `HIT` / `MISS` が出る
- オリジン IP に直接 `curl -k https://<origin-ip>/` して **接続拒否** になる
- ゲームから実際にスコアを送信して 200 が返る
- Security → Events で、意図的に連打したときにレート制限のイベントが出る

## アプリ側の安全弁 (おさらい)

Cloudflare を抜けてきた分に対して、アプリは次で守る。すべて環境変数で調整できる (README 参照)。

- `SUBMIT_RATE_MAX` / `READ_RATE_MAX`: IP ごと (IPv6 は /64 ごと) のレート制限
- `SUBMIT_DAILY_MAX`: 1 日の総受付件数。超えたら `/submit` だけ 503
- `MIN_FREE_DISK_MB`: ディスク空きがこれを切ったら `/submit` だけ 503
- 接続タイムアウト (headers 15 秒、request 30 秒、keep-alive 5 秒) は `index.js` に固定
- `STATS_INTERVAL_MS` ごとに受付・重複・拒否・制限・容量拒否の件数をログに出す
