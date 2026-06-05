# Bakabakaband Score Server

[馬鹿馬鹿蛮怒 (bakabakaband)](https://github.com/deskull-m/bakabakaband) が
ゲーム終了時に送信する JSON ダンプを受信・解析し、リーダーボードとして表示する
スコアサーバーです。

ゲーム側は `src/io-dump/score-sender.cpp` の `send_score_json()` が、
`dump_player_status_json()` で生成した JSON を `POST /submit` に送信します
(`WORLD_SCORE` ビルド時、既定の送信先は `http://localhost:3000/submit`)。

## 起動

```bash
npm install
npm start            # http://localhost:3000
PORT=8080 npm start  # ポート変更
```

## エンドポイント

| Method | Path | 説明 |
| ------ | ---- | ---- |
| `GET`  | `/` | サーバー案内ページ |
| `GET`  | `/leaderboard` | 整形済みリーダーボード (HTML / 30秒ごとに自動更新) |
| `GET`  | `/scores` | 全スコアを JSON で取得 |
| `POST` | `/submit` | スコア (Bakabakaband の JSON ダンプ) を投稿 |
| `DELETE` | `/scores/:id` | 指定 ID のスコアを削除 |

リーダーボードの各行をクリックすると、解析済みステータスと生 JSON を
タブで切り替えて全項目を閲覧できます。

## 受信する JSON フォーマット

`version.format` は `bakabakaband-creature-status`。
(出力元: `src/io-dump/player-status-dump-json.cpp`)

```jsonc
{
  "version": { "format": "bakabakaband-creature-status", "version": 1 },
  "basic":  { "name", "level", "experience", "max_experience", "age",
              "height", "weight", "prestige", "race", "class", "sex",
              "personality", "realm1", "realm2", "mimic_form", "monrace" },
  "stats":  [ { "name": "STR", "current", "max", "use", "top" }, ... ],
  "status": { "hitpoints", "max_hitpoints", "mana", "max_mana",
              "armor_class", "display_armor_class", "gold",
              "dungeon_level", "max_dungeon_level", "game_turn" },
  "combat": { "base_to_hit", "melee_to_hit", "melee_to_damage",
              "ranged_to_hit", "num_blow", "num_fire" },
  "skills": { "fighting", "shooting", "saving_throw", "stealth",
              "perception", "searching", "disarming", "magic_device",
              "infravision", "speed" },
  "death":  { "is_dead", "cause", "killer_id", "last_message", "is_winner" },
  "history": [ "...", ... ]
}
```

`death` セクションは死亡・勝利時のみ付与されます (冒険中は省略)。
旧来のフラット形式 (`name` / `race` / `max_plv` など) も後方互換で解釈します。

## スコア計算

JSON にはスコア値そのものが含まれないため、本家の `calc_score()`
(`src/player/player-status.cpp`) の基礎式を標準オプション (倍率 100%) で
近似して算出します。

```
score = max_experience + 100 * max_dungeon_level
```

`preserve_mode` / `autoroller` / `ironman` 各種・アリーナ成績・死亡回数などの
倍率/補正はダンプに含まれないため反映されません。

## サンプル投稿

```bash
curl -X POST http://localhost:3000/submit \
     -H "Content-Type: application/json" \
     -d @sample-dump.json
```

## テスト / Lint

```bash
npm test   # 解析ロジックのユニットテスト
npm run lint
```
