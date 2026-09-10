# ViXer AI Office — 設計書（MVP）

社内用 Web アプリ。10 人の AI 社員が役割分担して ViXer の業務改善を行う。
既存 ViXer 公式サイトとは **別 Worker** として `ai-office/` 配下に構築する。

## 0. 技術構成と方針

| 層 | 採用 |
|---|---|
| フロント配信 | Cloudflare Workers **Static Assets**（Vite でビルドした `dist/` を配信、SPA モード） |
| API | 同じ Worker 内の `fetch` ハンドラ（Hono でルーティング、`/api/*` は Worker 優先） |
| DB | Cloudflare **D1**（マイグレーションは `migrations/*.sql`） |
| 非同期処理 | Cloudflare **Workflows**（`DailyOfficeWorkflow`：アイデア生成 → 担当割当 → 成果物作成） |
| 定期実行 | Cron Trigger（毎日 09:00 JST = `0 0 * * *` UTC）→ Workflow 起動 |
| LLM | Anthropic Claude（`@anthropic-ai/sdk`、モデル `claude-opus-5`、JSON が必要な工程は Structured Outputs） |
| 認証 | Cloudflare Access（Worker のドメイン全体を保護、コード不要）を推奨。代替: 共有パスワード（`OFFICE_PASSWORD` secret） |
| フロント | Vite + TypeScript（フレームワーク無し）。黒白基調、iPad 横向き最優先（タップ領域 44px 以上） |

## 1. フォルダ構成

```
ai-office/
├── wrangler.jsonc            # Worker / Static Assets / D1 / Workflows / Cron の設定
├── package.json
├── tsconfig.json
├── vite.config.ts            # web/ → dist/ にビルド
├── migrations/
│   └── 0001_init.sql         # テーブル定義
├── seeds/
│   └── 0001_employees.sql    # AI 社員 10 人 + デフォルトプロジェクト
├── web/                      # フロント（Static Assets の元）
│   ├── index.html
│   ├── styles.css            # 黒白テーマ、iPad 向けレイアウト
│   └── src/
│       ├── main.ts           # ルーティング（#/ , #/ideas , #/ideas/:id）
│       ├── api.ts            # fetch ラッパ
│       ├── views/
│       │   ├── office.ts     # ① トップ：社員 10 人 + 「今日の仕事を開始」+ 今日の結果
│       │   ├── run.ts        # 進捗表示（アイデア → 担当 → 成果物）と採用/修正/却下
│       │   └── ideas.ts      # 過去アイデア履歴
│       └── components.ts     # カード・ボタン・ステータス表示の共通部品
└── src/                      # Worker
    ├── index.ts              # fetch / scheduled のエントリ、Workflow クラスを export
    ├── env.ts                # Bindings 型
    ├── employees.ts          # AI 社員 10 人の定義（id, 役割, system prompt）
    ├── api/
    │   ├── app.ts            # Hono アプリ（/api 配下）
    │   ├── employees.ts
    │   ├── runs.ts
    │   └── ideas.ts
    ├── db/
    │   └── repo.ts           # D1 クエリ（runs / ideas / tasks / outputs）
    ├── ai/
    │   ├── client.ts         # Anthropic SDK 呼び出し（共通）
    │   ├── prompts.ts        # 工程ごとのプロンプト
    │   └── schemas.ts        # Structured Outputs 用 JSON Schema
    └── workflows/
        └── daily-office.ts   # DailyOfficeWorkflow
```

## 2. D1 テーブル設計

MVP で使う 6 テーブル。将来機能（引き継ぎ・指示）はテーブルを追加する形で拡張できる設計。

```sql
-- AI 社員（シードで 10 人投入）
employees (
  id            TEXT PRIMARY KEY,       -- 'idea', 'research', 'planning', ...
  name          TEXT NOT NULL,          -- '毎日アイデア社員'
  role_title    TEXT NOT NULL,          -- 'Idea Generator'
  description   TEXT NOT NULL,          -- 担当領域の説明（UI 表示 & 割当判断に使用）
  system_prompt TEXT NOT NULL,          -- この社員として振る舞う指示
  sort_order    INTEGER NOT NULL,
  is_active     INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL
)

-- プロジェクト（MVP はデフォルト 1 件「ViXer 業務改善」）
projects (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT,
  status      TEXT NOT NULL DEFAULT 'active',
  created_at  TEXT NOT NULL
)

-- 「今日の仕事」1 回分 = Workflow 1 インスタンス
runs (
  id                   TEXT PRIMARY KEY,
  project_id           TEXT NOT NULL REFERENCES projects(id),
  run_date             TEXT NOT NULL,   -- 'YYYY-MM-DD'（JST）
  trigger              TEXT NOT NULL,   -- 'manual' | 'cron'
  status               TEXT NOT NULL,   -- 'queued' | 'generating_idea' | 'assigning' | 'producing' | 'completed' | 'failed'
  workflow_instance_id TEXT,
  error                TEXT,
  started_at           TEXT NOT NULL,
  finished_at          TEXT
)

-- アイデア（毎日アイデア社員が生成）＋ 採用/修正/却下 の判断
ideas (
  id              TEXT PRIMARY KEY,
  run_id          TEXT NOT NULL REFERENCES runs(id),
  project_id      TEXT NOT NULL REFERENCES projects(id),
  employee_id     TEXT NOT NULL REFERENCES employees(id),  -- 生成者（= idea）
  title           TEXT NOT NULL,
  summary         TEXT NOT NULL,
  rationale       TEXT NOT NULL,        -- なぜ今この改善か
  category        TEXT NOT NULL,        -- '集客' | '会員継続' | 'コンテンツ' | 'Web' | '営業' | '分析' | '業務効率'
  expected_impact TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'proposed',  -- 'proposed' | 'adopted' | 'revise' | 'rejected'
  decision_note   TEXT,                 -- 修正指示・却下理由
  decided_at      TEXT,
  created_at      TEXT NOT NULL
)

-- タスク（プロジェクト管理社員が担当を割り振る）
tasks (
  id                   TEXT PRIMARY KEY,
  project_id           TEXT NOT NULL REFERENCES projects(id),
  idea_id              TEXT REFERENCES ideas(id),
  run_id               TEXT REFERENCES runs(id),
  title                TEXT NOT NULL,
  description          TEXT NOT NULL,
  assignee_employee_id TEXT NOT NULL REFERENCES employees(id),
  assigned_by_employee_id TEXT REFERENCES employees(id),   -- 'pm'
  assignment_reason    TEXT,            -- なぜこの社員か
  status               TEXT NOT NULL DEFAULT 'todo',  -- 'todo' | 'in_progress' | 'done' | 'failed'
  priority             TEXT NOT NULL DEFAULT 'normal',
  created_at           TEXT NOT NULL,
  updated_at           TEXT NOT NULL
)

-- 成果物（担当社員の回答を保存）
outputs (
  id            TEXT PRIMARY KEY,
  task_id       TEXT NOT NULL REFERENCES tasks(id),
  employee_id   TEXT NOT NULL REFERENCES employees(id),
  summary       TEXT NOT NULL,          -- 一覧用の要約（1〜2 行）
  content_md    TEXT NOT NULL,          -- 本文（Markdown）
  model         TEXT NOT NULL,
  input_tokens  INTEGER,
  output_tokens INTEGER,
  created_at    TEXT NOT NULL
)

-- インデックス
runs(run_date, project_id) / ideas(status, created_at) / tasks(idea_id) / outputs(task_id)
```

将来追加予定（MVP では作らない）：
`task_handoffs`（from/to 社員・理由）、`instructions`（人 → 社員への指示とその回答）、`task_comments`。

## 3. API 構成（すべて `/api` 配下、JSON）

| Method | Path | 用途 |
|---|---|---|
| GET | `/api/health` | 稼働確認 |
| GET | `/api/employees` | AI 社員 10 人一覧 |
| GET | `/api/office` | トップ画面用まとめ：社員一覧 + 今日の run（あれば） + 直近アイデア 5 件 |
| POST | `/api/runs` | 「今日の仕事を開始」。run を作成し Workflow を起動。同日に進行中の run があれば 409 でそれを返す（`{force:true}` で再実行可） |
| GET | `/api/runs/:id` | run の進捗 + idea + task + output（フロントが 2 秒間隔でポーリング） |
| GET | `/api/runs` | run 履歴（`?limit=`） |
| GET | `/api/ideas` | 過去アイデア履歴（`?status=proposed|adopted|revise|rejected&limit=`） |
| GET | `/api/ideas/:id` | アイデア詳細（task, output を含む） |
| POST | `/api/ideas/:id/decision` | `{decision:'adopted'|'revise'|'rejected', note?}` を保存 |

後続フェーズで追加：`/api/projects`（CRUD）、`/api/tasks`（作成・担当変更・進捗更新）、`POST /api/tasks/:id/handoff`、`POST /api/employees/:id/instruct`。

## 4. Workflows の流れ

`DailyOfficeWorkflow`（params: `{ runId }`）。各 step は `step.do` で実行し、失敗時は指数バックオフで最大 3 回リトライ。DB 書き込みは run_id で冪等化（再実行しても二重登録しない）。

```
[起動]  POST /api/runs（手動） または Cron 09:00 JST（自動）
   │      → runs に status='queued' で 1 行作成 → DAILY_OFFICE.create({ runId })
   ▼
step 1  load-context
        project と直近 30 件のアイデアタイトル（重複回避用）を読む。runs.status='generating_idea'
   ▼
step 2  generate-idea     … 毎日アイデア社員（idea）
        Claude に Structured Outputs で {title, summary, rationale, category, expected_impact} を生成させ
        ideas に保存。runs.status='assigning'
   ▼
step 3  assign            … プロジェクト管理社員（pm）
        社員 10 人の description を渡し、{assignee_employee_id, task_title, task_description, reason} を
        Structured Outputs で決定 → tasks に保存（status='in_progress'）。runs.status='producing'
   ▼
step 4  produce           … 割り当てられた社員
        その社員の system_prompt でタスクを実行し Markdown の成果物を生成 → outputs に保存、
        tasks.status='done'
   ▼
step 5  finalize
        runs.status='completed', finished_at を記録
   ✕     どこかで失敗 → runs.status='failed', error に内容を保存（UI に表示、再実行ボタン）
```

フロントは `GET /api/runs/:id` をポーリングし、`status` に応じて
「アイデア生成中 → 担当割当中 → 成果物作成中 → 完了」を段階表示する。
完了後、画面に「採用 / 修正 / 却下」ボタンを表示し `POST /api/ideas/:id/decision` を呼ぶ。

## 5. UI（MVP 画面）

1. **Office（トップ）** … 上部にヘッダーと「今日の仕事を開始」ボタン、AI 社員 10 人のカードグリッド（iPad 横向きで 5 列 × 2 行）、その下に「今日の仕事」パネル（進捗 → アイデア → 担当社員 → 成果物 → 採用/修正/却下）
2. **Ideas（履歴）** … 過去アイデアの一覧（ステータス絞り込み）、タップで詳細
3. **Idea 詳細** … アイデア全文 + 担当タスク + 成果物 Markdown + 判断ボタン

デザイン：背景 #0A0A0A / 面 #141414 / 文字 #F5F5F5 / 罫線 #2A2A2A、アクセントは白のみ。細めのサンセリフ、余白広め、角丸小さめ。タッチ操作前提でボタン高さ 48px。

## 6. 確認したい点

1. 配置場所：このリポジトリの `ai-office/` 配下でよいか（別リポジトリ希望なら指示ください）
2. LLM：Anthropic Claude（`claude-opus-5`）でよいか。`ANTHROPIC_API_KEY` を secret で登録する前提
3. 認証：Cloudflare Access（推奨・コード不要）か、共有パスワード方式か
4. 自動生成の時刻：毎日 09:00 JST でよいか
5. フロント：Vite + TypeScript（React 等なし）でよいか
