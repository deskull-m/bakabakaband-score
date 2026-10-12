# bakabakaband-score

[馬鹿馬鹿蛮怒 (Bakabakaband)](https://github.com/deskull-m/bakabakaband) 用のスコアサーバ。
ゲームから JSON で送られてくるスコア登録を受け付け、SQLite に保存し、ランキングを表示する。

## 起動

```sh
npm ci
ADMIN_TOKEN=$(openssl rand -hex 32) npm start
```

Node.js 20 以上が必要。データは既定で `./data/scores.sqlite` に保存される。

### 環境変数

| 変数 | 既定値 | 説明 |
|---|---|---|
| `PORT` | `3000` | 待ち受けポート |
| `SCORES_DB` | `./data/scores.sqlite` | SQLite ファイル。`:memory:` でインメモリ |
| `ADMIN_TOKEN` | (未設定) | 管理操作用 Bearer トークン。未設定なら削除などの管理操作は 503 で無効 |
| `TRUST_PROXY` | `0` | リバースプロキシ配下で `X-Forwarded-For` を信用する段数。レート制限の IP 判定に使う |
| `CLIENT_IP_HEADER` | (未設定) | クライアント IP を取るヘッダ (Cloudflare なら `CF-Connecting-IP`)。前段以外からの直接接続を塞いでいる場合のみ設定する |
| `CORS_ORIGIN` | `*` | 読み取り API (`GET /scores`) に付ける CORS Origin |
| `BODY_LIMIT` | `512kb` | `POST /submit` のボディ上限 |
| `SUBMIT_RATE_WINDOW_MS` | `600000` | `/submit` レート制限のウィンドウ (ms) |
| `SUBMIT_RATE_MAX` | `10` | ウィンドウ内に 1 IP が送信できる回数 |
| `READ_RATE_WINDOW_MS` | `60000` | 読み取り API / ページのレート制限のウィンドウ (ms) |
| `READ_RATE_MAX` | `120` | ウィンドウ内に 1 IP が読み取れる回数 |
| `DISABLE_RATE_LIMIT` | | `1` でレート制限を無効化 (テスト用) |
| `SUBMIT_DAILY_MAX` | `500` | 1 日 (UTC) の総受付件数。超えたら `/submit` が 503。`0` で無効 |
| `MIN_FREE_DISK_MB` | `1024` | DB のあるディスクの空きがこれを切ったら `/submit` が 503。`0` で無効 |
| `STATS_INTERVAL_MS` | `3600000` | 受付・拒否などの件数をログに出す間隔。`0` で無効 |
| `MAX_PAGE_SIZE` | `200` | `GET /scores` の 1 ページ最大件数 |

本番では Cloudflare を前段に置き、オリジンの Caddy / nginx で TLS を終端する構成を想定している。
手順は [deploy/cloudflare.md](deploy/cloudflare.md) を参照。`TRUST_PROXY=1` と `CLIENT_IP_HEADER=CF-Connecting-IP` を忘れると全員が同じ IP に見えてレート制限で締め出される。

## API

### `POST /submit`

`Content-Type: application/json` で [`schema/ScoreSubmission.schema.json`](schema/ScoreSubmission.schema.json) に従う JSON を送る。
ゲーム側の `dump_player_status_json()` の出力 (`bakabakaband-creature-status`) をそのまま送った場合も受理するが、
スコアの再計算ができないため `legacy_format` フラグ付きで保存される。

```jsonc
{
  "format": "bakabakaband-score-submission",
  "format_version": 1,
  "game":     { "version": "1.2.3-abcdef", "platform": "win", "locale": "ja" },
  "score":    { "points": 123456, "options": { "preserve_mode": true, "ironman_rooms": false, "...": false },
                "arena_wins": -1, "spectre_berserker": false, "munchkin": false },
  "progress": { "max_level": 40, "max_max_experience": 1000000, "real_turns": 200000, "play_time_sec": 7200,
                "max_depth_overall": 80, "max_depth": { "ANGBAND": 80 }, "death_count": 0,
                "total_winner": false, "true_winner": false },
  "character": { /* dump_player_status_json() の出力 */ },
  "attachments": { "character_dump": "...", "screen_dump": "<html>...</html>" }
}
```

応答は HTTP 200 で `{ success, id, rank, points, flags, duplicate }`。ゲーム側は 200 のみを成功として扱う。

- `submission_id` (UUID、任意) を送ると、同じ値での再送は登録せず既存の記録を `duplicate: true` で返す。
  クライアントは送信内容を組み立てた時点で生成し、再送時も同じ値を使うこと。
- `submission_id` が無くても、添付を除いた内容が完全に一致する送信は同一と見なす。

- `points` はサーバが `calc_score()` と同じ式で再計算した値。再計算に必要な項目 (`score.options`, `progress.max_max_experience`) が無い場合は申告値を使う。
- `flags` は妥当性チェックの結果。拒否はせず、怪しい記録に印を付けて保存する
  (`score_mismatch`, `level_out_of_range`, `exp_exceeds_max`, `depth_exceeds_max`, `zero_turns`, `not_dead`, `legacy_format`, `score_not_recomputable`)。

スキーマ違反、不正な JSON、上限超過はそれぞれ 400 / 400 / 413。レート制限超過は 429。

### `GET /scores?limit=&offset=`

ランキングを JSON で返す (`{ total, limit, offset, scores: [...] }`)。添付データは含まない。

### `GET /scores/:id`

1 件の詳細。送信された JSON 全体を `submission` に含む。

### `GET /leaderboard`

ランキングの HTML ページ。サーバは HTML を文字列連結せず、ブラウザ側で DOM API のみで描画する。
スクリーンショット (HTML) はスクリプト実行不可の sandbox iframe に閉じ込めて表示する。

### 管理操作 (`Authorization: Bearer <ADMIN_TOKEN>`)

- `DELETE /scores/:id` — 記録を削除
- `POST /scores/:id/verify` `{ "verified": true|false }` — 人手で確認した記録に「検証済」を付ける

### `GET /healthz`

死活監視用。`{ ok, uptime_sec, total, free_disk_mb, submissions_today }` を返す。レート制限の対象外。

## デプロイ

`deploy/` に構成例がある。

| ファイル | 内容 |
|---|---|
| `deploy/cloudflare.md` | Cloudflare を前段に置く手順 (DNS, TLS, オリジン遮断, WAF, キャッシュ) |
| `deploy/Caddyfile` | オリジン側の Caddy 設定。Origin CA 証明書で TLS 終端し、ログからクライアント IP を落とす |
| `deploy/bakabakaband-score.service` | systemd unit。書き込み先を `/var/lib/bakabakaband-score` に限定 |
| `deploy/bakabakaband-score.env.example` | 環境変数ファイルの雛形 |
| `deploy/bakabakaband-score-backup.{service,timer}` | 日次バックアップの systemd timer |
| `Dockerfile`, `deploy/compose.yaml` | コンテナで動かす場合 |

### バックアップ

```sh
npm run backup                      # <DATA_DIR>/backups/scores-<日時>.sqlite に書き出す
npm run backup -- /mnt/backup/score # 出力先を指定
```

SQLite のオンラインバックアップ API を使うので、サーバを止めずに整合したコピーが取れる。
`BACKUP_KEEP` (既定 14) 世代より古いものは削除する。復元はサーバを止めて `scores.sqlite` を差し替えるだけでよい
(`scores.sqlite-wal`, `scores.sqlite-shm` があれば一緒に消す)。

## 旧 `scores.json` からの移行

```sh
npm run import-legacy -- path/to/scores.json
```

## 開発

```sh
npm run lint
npm test
```

## セキュリティ方針

クライアントが自己申告するスコアは原理的に偽造できるため、このサーバは「偽造不可能」ではなく
「大量投稿や荒らしに耐える」「怪しい記録を後から見分けて消せる」ことを目標にしている。

- JSON Schema による入力検証と、文字列長・数値範囲の上限
- IP ごと (IPv6 は /64 ごと) のレート制限、ボディサイズ上限
- 日次受付上限とディスク空き容量による `/submit` の自動停止 (閲覧は維持)
- 接続タイムアウトを短く設定し、遅い接続を大量に張られても資源を握り続けない
- volumetric な攻撃は Cloudflare に任せる ([deploy/cloudflare.md](deploy/cloudflare.md))
- 申告スコアを信用せず、申告された入力から同じ式で再計算して乖離を記録
- 明らかに不可能な値は拒否せず `flags` を付けて保存し、管理者が確認・削除できる
- 管理操作はトークン必須。未設定時は無効
- 出力は JSON のみ。HTML はブラウザ側で `textContent` により構築し、CSP で inline script を禁止
- IP アドレスは記録本体に保存しない。レート制限のメモリ内カウンタにだけ短時間残る。前段 (Caddy) のアクセスログからも落とす設定にしている (`deploy/Caddyfile`)
- アカウント登録やログインは要求しない。メールアドレス等の個人情報も収集しない

## プライバシー

掲載される情報の範囲、保持期間、削除依頼の手順はトップページ (`public/index.html` の「掲載される情報と削除依頼」) に書いてある。
運営者が変わる場合は、削除依頼の連絡先をそこで差し替えること。

ゲーム本体側では、スコア送信の確認プロンプトに「キャラクター名・遺言・ダンプが公開サーバに掲載される」旨を明記する必要がある (deskull-m/bakabakaband-score#13)。
