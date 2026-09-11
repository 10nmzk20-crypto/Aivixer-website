# ViXer AI Company

Life Design ViXer の社内用 Web アプリ。経営データを入力すると、**保存 → KPI の自動計算 → 分析材料の整理 → ChatGPT 用レポートの生成**まで行います。
生成したレポートを ChatGPT に貼り付けて深い分析を行う、という使い方です。

**今の運用では外部 AI（Claude / OpenAI）を呼びません。** 計算と整理はすべてアプリ内で行い、文章による分析は ChatGPT に任せます。
AI 社員 18 人（分析部 8・司令塔 1・実行部 6・検証部 3）は、数字を読むときの観点として画面で確認できます。

- 公式 HP とは **別の Worker・別の D1・別の URL** で動きます。HP 側には一切触れません。
- AI は文章・原稿・仕様書を作るだけです。HP 公開・広告出稿・SNS 投稿・LINE 送信・料金変更・会員データ変更は AI からは行えず、代表の承認と人の操作が必要です。
- 設計の全体像は `../docs/AI_COMPANY_DESIGN.md` を参照してください。

## 構成

| 役割 | 使うもの |
|---|---|
| 画面 | Cloudflare Workers Static Assets（`web/` を Vite でビルドして `dist/` を配信） |
| API | 同じ Worker 内の Hono（`src/api/`） |
| データ | Cloudflare D1（`migrations/`） |
| 分析の自動実行 | Cloudflare Workflows（`src/workflows/`）: 分析担当を選ぶ → 各担当が分析 → 司令塔が統合 → 実行担当が成果物を作る |
| AI | `src/ai/provider.ts` の窓口を通して呼ぶ。初期は Anthropic Claude（`claude-opus-5`）。`AI_PROVIDER=mock` にすると API キー無しで動作確認できる |
| 認証 | Cloudflare Access（推奨）または共有パスワード |

## ローカルで動かす（API キー不要）

```bash
cd ai-company
npm install
cp .dev.vars.example .dev.vars        # AI_PROVIDER=mock のまま
npm run db:migrate:local               # ローカル D1 にテーブルと AI 社員を作る
npm run dev                            # http://localhost:8787
```

画面の「新しい分析」→「分析開始」で、固定のサンプル回答を使って一連の流れ（分析 → 施策 → 承認 → KPI）を試せます。
本物の Claude で試すときは `.dev.vars` に `AI_PROVIDER=anthropic` と `ANTHROPIC_API_KEY=...` を書いて再起動します。

## 本物の Claude と通信できるか確かめる（公開前に 1 回）

```bash
cd ai-company
ANTHROPIC_API_KEY=sk-ant-... npm run ai:check
```

サンプルの数字を使って「司令塔が担当を選ぶ」「担当 1 人が分析する」の 2 回だけ Claude を呼び、
返答が **事実 / 仮説 / 根拠となった数字 / 追加で必要なデータ** に分かれて返ることを画面に表示します（費用は数円〜十数円程度）。
ここで失敗する場合は API キーか通信の問題なので、公開前に直せます。

## Cloudflare に公開する

前提: Cloudflare アカウント（HP と同じでよい）、Node.js 20 以上、Anthropic の API キー。

1. **ログイン**
   ```bash
   cd ai-company && npm install
   npx wrangler login
   ```
2. **D1 を作る**
   ```bash
   npx wrangler d1 create vixer-ai-company-db
   ```
   表示された `database_id` を `wrangler.jsonc` の `REPLACE_WITH_YOUR_D1_DATABASE_ID` に貼り付けます。
3. **テーブルと AI 社員を入れる**
   ```bash
   npm run db:migrate
   ```
4. **API キーを金庫に入れる**（画面や Git には絶対に書かない）
   ```bash
   npx wrangler secret put ANTHROPIC_API_KEY
   ```
5. **公開**
   ```bash
   npm run deploy
   ```
   `https://vixer-ai-company.<アカウント名>.workers.dev` が発行されます。
6. **入口を閉じる（必須）** — どちらか一方を設定します。設定するまで API は「認証未設定」で拒否されます。
   - **A. Cloudflare Access（推奨）**: Cloudflare ダッシュボード → Zero Trust → Access → Applications → 「Add an application」→ Self-hosted。
     Application domain に上の URL、Policy に許可するメールアドレスを登録。作成後に表示される **Application Audience (AUD) Tag** をコピーし、
     `wrangler.jsonc` の `CF_ACCESS_TEAM_DOMAIN`（Zero Trust のチーム名。`https://<チーム名>.cloudflareaccess.com` の部分）と `CF_ACCESS_AUD` に入れて `npm run deploy` し直します。
   - **B. 共有パスワード**: `npx wrangler secret put APP_PASSWORD` でパスワードを登録（`APP_SESSION_SECRET` も長いランダム文字列で登録すると安全）。画面にログイン欄が出ます。
7. **iPad で開く** — Safari で URL を開き、共有メニューの「ホーム画面に追加」を押すとアプリのように使えます。
8. （任意）独自ドメイン `ai.<既存ドメイン>` を Worker の Custom Domain として追加できます。HP のドメイン設定は変更しません。

## 設定値（`wrangler.jsonc` の `vars`）

| 名前 | 意味 | 初期値 |
|---|---|---|
| `AI_PROVIDER` | `none`（外部 AI を呼ばない・今の運用）/ `claude` / `mock`（開発用） | `none` |
| `AI_MODEL` | 使うモデル | `claude-opus-5` |
| `AI_MAX_OUTPUT_TOKENS` | 1 回の回答の上限 | `8000` |
| `AI_EFFORT` | 考える深さ（`low` / `medium` / `high`） | `medium` |
| `CF_ACCESS_TEAM_DOMAIN` / `CF_ACCESS_AUD` | Cloudflare Access の設定 | 空 |

秘密情報（`wrangler secret put` で登録）: `ANTHROPIC_API_KEY`、`APP_PASSWORD`、`APP_SESSION_SECRET`。

## フォルダ

```
ai-company/
├── wrangler.jsonc         Worker / Static Assets / D1 / Workflows の設定
├── migrations/            D1 のテーブル定義と AI 社員の初期データ
├── web/                   画面（Vite + TypeScript）
│   └── src/views/         dashboard / new-analysis / project / history / knowledge / employee / login
└── src/                   Worker
    ├── api/               API（auth, dashboard, employees, projects, tasks, knowledge）
    ├── ai/                AI プロバイダ層（provider / anthropic / mock / schemas）
    ├── db/repo.ts         D1 の読み書き
    ├── employees/         AI 社員 17 人の定義と役割プロンプト
    ├── policy/            承認が必須の行為の判定
    └── workflows/         分析パイプライン / 修正パイプライン
```

## API 一覧

| Method | Path | 内容 |
|---|---|---|
| GET | `/api/health` | 稼働確認（認証不要） |
| POST | `/api/projects/:id/report` | ChatGPT 用レポートを作成して D1 に保存 |
| GET | `/api/projects/:id/reports` | この案件のレポート履歴 |
| POST | `/api/tasks/:id/verify-ai` | KPI 実績を保存し、KPI 検証担当 AI に判定を依頼（AI 接続時のみ） |
| GET/POST | `/api/auth/me`, `/api/auth/login`, `/api/auth/logout` | 認証状態・共有パスワードのログイン |
| GET | `/api/dashboard` | 今日の状況・最優先・社員の稼働 |
| GET | `/api/employees`, `/api/employees/:id` | AI 社員一覧・詳細（役割・現在の仕事・過去の成果） |
| GET | `/api/projects/metrics` | 入力画面の数値項目 |
| POST / GET | `/api/projects`, `/api/projects/:id` | 分析開始（Workflow 起動）・案件の全部 |
| POST | `/api/projects/:id/retry`, `/api/projects/:id/cancel` | 失敗した案件の再実行・分析の中止 |
| POST | `/api/tasks/:id/approval` | 採用 / 修正 / 却下 |
| POST | `/api/tasks/:id/status`, `/api/tasks/:id/verify` | 「実施した」・KPI 実績と 続行 / 改善 / 中止 |
| PUT / PATCH | `/api/tasks/:id/kpis`, `/api/kpis/:id` | KPI の設定・更新 |
| GET / POST | `/api/knowledge` | ナレッジ一覧・手動追加 |

## 分析結果の見方

各分析担当と経営司令塔の結果は、必ず次の 4 つに分けて表示されます。

| 区分 | 意味 |
|---|---|
| 事実 | 入力した数字から言い切れること |
| 仮説 | 事実から考えられる原因（「〜の可能性」） |
| 根拠となった数字 | どの数字を根拠にしたか。入力にある数字と、そこから計算した数字（計算式つき）だけ |
| 追加で必要なデータ | 仮説を確かめるために次回入力してほしいデータ |

AI には「入力に無い数字を作らない」よう指示しています。根拠の欄に見覚えのない数字があれば、その分析は疑ってください。

## よくある質問

- **分析が「分析中」のまま進まない** … 案件詳細に「分析を中止」ボタンが出ます（8 分経過後）。中止 → 「続きから再実行」で、保存済みの分析結果は飛ばして再開します。
- **同時に 2 つ分析できない** … 仕様です（AI 費用と混乱を防ぐため）。完了してから次を始めてください。
- **AI を別の会社のものに替えたい** … `src/ai/` に新しい実装を足し、`AI_PROVIDER` を切り替えます。画面と API は変更不要です。
