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
| `SUSPICION_HIDE_THRESHOLD` | `3` | 未検証でフラグの重み合計がこれ以上の記録を既定表示から外す。`0` で無効 |
| `MIN_TURNS_PER_LEVEL` | `0` | レベル 1 あたりに最低限かかるはずの実ターン数。`0` で無効。既存記録の分布を見てから決める |

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
- `flags` は妥当性チェックの結果。拒否はせず、怪しい記録に印を付けて保存する。
- `suspicion` はフラグの重み付け合計。未検証でこれが `SUSPICION_HIDE_THRESHOLD` (既定 3) 以上の記録は、
  既定のランキング表示から外れる (`include_flagged=1` で表示、管理者が検証済みにすれば常に表示)。

| フラグ | 重み | 意味 |
|---|---|---|
| `level_exp_mismatch` | 3 | 経験値から導かれるレベル (種族・職業の係数込み) と申告レベルが一致しない |
| `level_out_of_range` / `level_exceeds_max_level` | 3 | レベルが 50 超、または最高レベルを超えている |
| `exp_exceeds_max` / `depth_exceeds_max` | 3 | 現在値が最大値を超えている |
| `depth_exceeds_dungeon_max` | 3 | ダンジョン定義の最深階を超えている |
| `stat_out_of_range` | 3 | 能力値が内部表現の範囲外 |
| `winner_flags_inconsistent` | 2 | `true_winner` なのに `total_winner` でない |
| `zero_turns` | 2 | レベル 2 以上なのに実ターン 0 |
| `level_too_fast` | 2 | レベルあたりの実ターンが `MIN_TURNS_PER_LEVEL` 未満 (既定では無効) |
| `score_mismatch` | 1 | 申告スコアと再計算が一致しない (ランキングは再計算値) |
| `unknown_race` / `unknown_class` | 1 | 種族・職業の名称がゲームの表に無い |
| `unknown_version` | 1 | `game.version` がゲームの書式に合わない |
| `not_dead` / `score_not_recomputable` | 1 | 未死亡、または再計算に必要な項目が無い |
| `legacy_format` | 0 | 旧形式 (creature-status 単体) での送信 |

スキーマ違反、不正な JSON、上限超過はそれぞれ 400 / 400 / 413。レート制限超過は 429。

### `GET /scores?limit=&offset=`

ランキングを JSON で返す (`{ total, limit, offset, sort, filter, scores: [...] }`)。添付データは含まない。

絞り込みと並び順のクエリ:

| クエリ | 意味 |
|---|---|
| `race=`, `class=` | 種族・職業の完全一致 |
| `winner=1` | 勝者のみ |
| `version=` | ゲームバージョンの完全一致 |
| `name=` | 名前の部分一致 |
| `since=`, `until=` | 登録日時の範囲 (ISO 8601、`until` は未満) |
| `flagged=1` | フラグ付きで未検証の記録のみ |
| `include_flagged=1` | 疑わしさの閾値で隠している記録も含める |
| `sort=points` (既定) / `sort=recent` | スコア順 / 登録日時の新しい順 |

不正な値は無視される。実際に効いた条件は応答の `filter` に入る。

### `GET /stats`

集計。全体の件数・勝者数・検証済み数、種族別と職業別の件数・勝者数・最高記録、死因の上位 20、バージョン別件数。
60 秒のキャッシュを許可している。

### `GET /scores/:id`

1 件の詳細。送信された JSON を `submission` に含む (添付は除く)。
添付の有無とサイズは `attachments: { character_dump: { size }, screen_dump: { size } }` で分かる。

### `GET /scores/:id/attachments/:kind`

添付 (`character_dump` または `screen_dump`) の本文。常に `text/plain` と `Content-Security-Policy: sandbox` で返すので、
スクリーンショット (HTML) を直リンクで開いても文書として解釈されない。ランキングページは取得した本文を sandbox iframe に流し込んで表示する。

### `GET /leaderboard`

ランキングの HTML ページ。ランキング / 最近の記録 / 集計のタブと、種族・職業・バージョン・名前・期間・勝者の絞り込みがある。
表示状態は URL のクエリに反映されるので、絞り込んだ状態をそのまま共有できる。
サーバは HTML を文字列連結せず、ブラウザ側で DOM API のみで描画する。
スクリーンショット (HTML) はスクリプト実行不可の sandbox iframe に閉じ込めて表示する。

### `GET /scores?flagged=1`

フラグ付きで未検証の記録だけを登録日時の新しい順に返す。管理者が確認する対象の一覧。

### 管理操作 (`Authorization: Bearer <ADMIN_TOKEN>`)

- `DELETE /scores/:id` — 論理削除。公開 API から見えなくなるが行と添付は残り、同じ内容の再送も通らない
- `DELETE /scores/:id?purge=1` — 物理削除。添付も消え、再送が通るようになる
- `POST /scores/:id/restore` — 論理削除を取り消す
- `POST /scores/:id/verify` `{ "verified": true|false }` — 人手で確認した記録に「検証済」を付ける
- `GET /admin/scores/:id` — 論理削除済みも含めて詳細を返す
- `GET /admin/log` — 管理操作の監査ログ (日時、操作、記録 ID、理由)

管理操作の要求に `X-Admin-Reason: <理由>` を付けると監査ログに残る。

### 管理 CLI

```sh
export SCORE_SERVER_URL=https://score.example.net ADMIN_TOKEN=...
npm run admin -- list-flagged          # 要確認の記録を一覧
npm run admin -- show <id>
npm run admin -- verify <id> "ダンプを確認した"
npm run admin -- delete <id> "改竄の疑い"   # 論理削除 (restore で戻せる)
npm run admin -- purge <id>            # 物理削除
npm run admin -- log
```

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

添付は `attachments` テーブルに gzip 圧縮して保存する (テキストなので概ね 1/5 以下になる)。
記録を大量に削除した後にファイルサイズを戻したい場合は、サーバを止めて `sqlite3 data/scores.sqlite VACUUM` を実行する
(WAL のチェックポイントも同時に行われる)。

SQLite のオンラインバックアップ API を使うので、サーバを止めずに整合したコピーが取れる。
`BACKUP_KEEP` (既定 14) 世代より古いものは削除する。復元はサーバを止めて `scores.sqlite` を差し替えるだけでよい
(`scores.sqlite-wal`, `scores.sqlite-shm` があれば一緒に消す)。

## ゲーム本体の定数表

`src/data/game-tables.json` に、妥当性チェックに使う経験値表・種族と職業の経験値係数・ダンジョンの最深階・能力値の範囲を
ゲーム本体のソースから抜き出して置いてある。本体側の表が変わったら再生成してコミットする。

```sh
npm run extract-game-tables -- /path/to/bakabakaband > src/data/game-tables.json
```

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
