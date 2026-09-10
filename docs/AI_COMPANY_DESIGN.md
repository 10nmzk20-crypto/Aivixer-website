# ViXer AI Company — 設計書（MVP）

Life Design ViXer の社内用 Web アプリ。経営データや相談を入力すると、
**分析 → 問題発見 → 優先順位決定 → 担当 AI 選定 → 実行案作成 → 代表承認 → KPI 検証** を
AI 社員が役割分担して進める。

## 0. 前提の確認（既存 HP への影響なし）

- この作業リポジトリ `Aivixer-website` には HP のファイル・Worker 設定・データが **存在しない**（設計書のみ）。
- 公式 HP は別リポジトリ `vixer-hp-practice` にあり、このセッションからはアクセス不可。触れない。
- 本アプリは **別 Worker（名前: `vixer-ai-company`）・別 D1・別 URL** として作る。HP の Worker やドメイン設定は変更しない。

## 1. システム全体構成（ざっくり図）

```
iPad の Safari
   │  https://vixer-ai-company.<アカウント>.workers.dev  （後で ai.〜 の独自ドメインも可）
   ▼
┌──────────────────── Cloudflare Access（社内メンバーだけ通す門）────────────────────┐
│                                                                                     │
│  Cloudflare Worker「vixer-ai-company」（1 つの Worker がすべてを担当）               │
│   ├─ Static Assets …… 画面（HTML / CSS / JS）を配る                                  │
│   ├─ API（/api/…） …… 画面からの操作を受け付け、D1 を読み書きし、Workflow を起動      │
│   └─ Workflow「AnalysisPipeline」…… 分析 → 司令塔 → 施策 → 成果物 を順番に実行        │
│           │                                                                         │
│           ▼                                                                         │
│      AI プロバイダ層（src/ai/provider.ts）… 「文章を送って答えを受け取る」だけの薄い窓口   │
│           ├─ AnthropicProvider（初期: Claude）                                        │
│           └─ （将来）WorkersAIProvider / 他社モデル … ここだけ差し替えれば UI は無変更      │
│                                                                                     │
│  Cloudflare D1「vixer-ai-company-db」…… 案件・分析結果・施策・成果物・承認・KPI・ナレッジ   │
└─────────────────────────────────────────────────────────────────────────────────────┘
        ▲
        │ API キーは Worker の「秘密設定（wrangler secret）」に保存。画面側には一切置かない
```

**たとえ話**
- 画面（Static Assets）＝ 受付カウンター
- API ＝ 事務員。受付からの依頼を受けて、金庫（D1）を開けたり、作業手順書（Workflow）を回したりする
- Workflow ＝ 作業手順書。「分析部 → 司令塔 → 実行担当」の順に、途中で失敗しても続きから再開できる
- AI 社員 ＝ Worker の中にある「役割の説明書（プロンプト）」。実体は同じ AI モデルだが、役割ごとに別の指示を持つ
- AI プロバイダ層 ＝ 「どの AI 会社を使うか」を切り替える差し込み口

**なぜ Workflow を使うか**
1 回の分析で AI を 5〜12 回呼ぶ（分析担当 × 最大 8 ＋ 司令塔 ＋ 実行担当 × 最大 3）。
数分かかるため、1 回の通信で完了させると途中で切れる。Workflow なら 1 ステップずつ結果を保存し、失敗しても自動で再試行できる。

## 2. フォルダ構成

このリポジトリ直下に `ai-company/` フォルダを作る（HP のファイルは存在しないので混ざらない）。

```
ai-company/
├── wrangler.jsonc          # Worker 名・Static Assets・D1・Workflow の設定（HP とは別ファイル）
├── package.json
├── tsconfig.json
├── vite.config.ts          # web/ を組み立てて dist/ に出力
├── migrations/
│   └── 0001_init.sql       # D1 テーブル定義
├── seeds/
│   └── 0001_employees.sql  # AI 社員 17 人（分析 8・司令塔 1・実行 8）の初期データ
├── web/                    # 画面
│   ├── index.html
│   ├── styles.css          # 黒・白・グレー、iPad 向け
│   └── src/
│       ├── main.ts         # 画面の切り替え（#/ , #/new , #/projects/:id , #/history , #/knowledge）
│       ├── api.ts          # API を呼ぶ関数（fetch のまとめ）
│       ├── views/
│       │   ├── dashboard.ts    # ① ダッシュボード
│       │   ├── new-analysis.ts # ② データ・相談入力
│       │   ├── project.ts      # ③ 案件詳細（分析結果・司令塔・施策・成果物・承認・KPI）
│       │   ├── employee.ts     # ④ AI 社員詳細（タップで開く）
│       │   ├── history.ts      # ⑤ 履歴
│       │   └── knowledge.ts    # ⑥ ナレッジ一覧
│       └── components.ts   # カード・ボタン・ステータス表示などの共通部品
└── src/                    # Worker（サーバー側）
    ├── index.ts            # 入口。/api は API へ、それ以外は画面を返す。Workflow を登録
    ├── env.ts              # 使う設定・秘密情報の型
    ├── employees/
    │   ├── roster.ts       # 17 人の定義（id・部署・役割・見るもの）
    │   └── prompts/        # 1 人 1 ファイルの役割説明（プロンプト）
    ├── api/
    │   ├── app.ts          # ルーティング（Hono）
    │   ├── auth.ts         # Cloudflare Access の通行証を確認
    │   ├── dashboard.ts / employees.ts / projects.ts / tasks.ts / kpis.ts / knowledge.ts
    ├── db/
    │   └── repo.ts         # D1 の読み書き（SQL はここに集約）
    ├── ai/
    │   ├── provider.ts     # 共通の窓口（generateJSON / generateText）
    │   ├── anthropic.ts    # Claude 用の実装
    │   └── schemas.ts      # AI に返させる JSON の形（事実・仮説・追加データ・施策…）
    ├── policy/
    │   └── restricted-actions.ts  # 「承認なしでやってはいけない行為」の一覧と判定
    └── workflows/
        └── analysis-pipeline.ts   # 分析 → 司令塔 → 施策 → 成果物
```

## 3. D1 テーブル設計

「案件（project）」を中心に、下の順で結び付く。

```
projects（案件）
  ├── analyses（分析担当ごとの結果）            … 1 案件に 1〜8 行
  ├── decisions（経営司令塔の判断）              … 1 案件に 1 行（修正で増えることあり）
  └── tasks（最優先施策・最大 3）                … 1 案件に 0〜3 行
        ├── outputs（実行担当の成果物）          … 修正のたびに版が増える
        ├── approvals（採用 / 修正 / 却下 の記録）
        └── kpis（KPI の目標と実績）
knowledge（ナレッジ）… 完了・却下・学びを蓄積。司令塔と分析担当が毎回参照する
ai_employees（AI 社員）… 17 人のマスタ
```

```sql
-- AI 社員（初期データで 17 人）
ai_employees (
  id            TEXT PRIMARY KEY,   -- 'data', 'marketing', 'customer', 'sales', 'web', 'product',
                                    -- 'profit', 'competitor', 'commander',
                                    -- 'planner', 'content', 'webdev', 'growth', 'line', 'retention',
                                    -- 'kpi', 'knowledge'
  name          TEXT NOT NULL,      -- 'データ分析担当'
  department    TEXT NOT NULL,      -- 'analysis' | 'command' | 'execution'
  role_summary  TEXT NOT NULL,      -- 一言説明（カードに表示）
  watches_json  TEXT NOT NULL,      -- 見るもの（["売上","会員数",...]）
  sort_order    INTEGER NOT NULL,
  is_active     INTEGER NOT NULL DEFAULT 1
)

-- 案件（1 回の「分析開始」= 1 案件）
projects (
  id                     TEXT PRIMARY KEY,
  title                  TEXT NOT NULL,       -- 例: '2026年8月 月次データ'（未入力なら自動生成）
  period_label           TEXT,                -- '2026-08' など
  input_text             TEXT NOT NULL,       -- 相談内容・自由記述
  input_data_json        TEXT,                -- 数値入力（売上・会員数・見学…）を JSON で
  selected_analysts_json TEXT,                -- 司令塔が選んだ分析担当 id の配列
  status                 TEXT NOT NULL,       -- 'analyzing'（分析中）| 'candidates'（施策候補）|
                                              -- 'awaiting_approval'（代表承認待ち）| 'in_progress'（実行中）|
                                              -- 'awaiting_verification'（検証待ち）| 'completed'（完了）|
                                              -- 'rejected'（却下）| 'failed'（エラー）
  workflow_instance_id   TEXT,
  error                  TEXT,
  created_at             TEXT NOT NULL,
  updated_at             TEXT NOT NULL
)

-- 分析担当ごとの結果
analyses (
  id               TEXT PRIMARY KEY,
  project_id       TEXT NOT NULL REFERENCES projects(id),
  employee_id      TEXT NOT NULL REFERENCES ai_employees(id),
  status           TEXT NOT NULL,           -- 'running' | 'done' | 'failed'
  facts_json       TEXT,                    -- 事実（数字から言えること）
  hypotheses_json  TEXT,                    -- 仮説（たぶんこうでは、という推測）
  needed_data_json TEXT,                    -- 追加で欲しいデータ
  findings_md      TEXT,                    -- 異常値・傾向・ボトルネックの本文
  model            TEXT,
  input_tokens     INTEGER, output_tokens INTEGER,
  created_at       TEXT NOT NULL
)

-- 経営司令塔の判断
decisions (
  id               TEXT PRIMARY KEY,
  project_id       TEXT NOT NULL REFERENCES projects(id),
  version          INTEGER NOT NULL DEFAULT 1,
  summary_md       TEXT NOT NULL,           -- 「結局、今何をやるべきか」
  facts_json       TEXT NOT NULL,
  hypotheses_json  TEXT NOT NULL,
  needed_data_json TEXT NOT NULL,
  not_now_json     TEXT NOT NULL,           -- 今やらなくていいこと（理由つき）
  model            TEXT,
  created_at       TEXT NOT NULL
)

-- 最優先施策（= タスク。1 案件につき最大 3）
tasks (
  id                    TEXT PRIMARY KEY,
  project_id            TEXT NOT NULL REFERENCES projects(id),
  decision_id           TEXT NOT NULL REFERENCES decisions(id),
  rank                  INTEGER NOT NULL,     -- 1〜3
  title                 TEXT NOT NULL,
  objective             TEXT NOT NULL,        -- 目的
  reasoning             TEXT NOT NULL,        -- なぜ今これか（インパクト ÷ 必要時間 の説明）
  impact_score          INTEGER NOT NULL,     -- 1〜5
  effort_hours          REAL NOT NULL,        -- 想定作業時間
  executor_employee_id  TEXT NOT NULL REFERENCES ai_employees(id),
  assignment_reason     TEXT NOT NULL,        -- なぜこの担当か
  restricted_actions_json TEXT NOT NULL,      -- 承認が必須の行為（'publish_hp','run_ads','post_sns','send_line','change_price','edit_member_data'）
  status                TEXT NOT NULL,        -- 'candidate' | 'awaiting_approval' | 'revise' |
                                              -- 'in_progress' | 'awaiting_verification' | 'completed' | 'rejected'
  due_date              TEXT,
  created_at            TEXT NOT NULL,
  updated_at            TEXT NOT NULL
)

-- 成果物（修正のたびに version が増える）
outputs (
  id             TEXT PRIMARY KEY,
  task_id        TEXT NOT NULL REFERENCES tasks(id),
  employee_id    TEXT NOT NULL REFERENCES ai_employees(id),
  version        INTEGER NOT NULL DEFAULT 1,
  kind           TEXT NOT NULL,            -- 'plan'（企画書）| 'content'（原稿）| 'web_spec'（HP 変更仕様）|
                                           -- 'growth_plan' | 'line_script' | 'retention_plan'
  title          TEXT NOT NULL,
  content_md     TEXT NOT NULL,            -- 本文（Markdown）
  revision_note  TEXT,                     -- 修正指示（2 版目以降）
  model          TEXT,
  input_tokens   INTEGER, output_tokens INTEGER,
  created_at     TEXT NOT NULL
)

-- 代表の判断
approvals (
  id          TEXT PRIMARY KEY,
  task_id     TEXT NOT NULL REFERENCES tasks(id),
  output_id   TEXT REFERENCES outputs(id),
  decision    TEXT NOT NULL,   -- 'adopted' | 'revise' | 'rejected'
  note        TEXT,            -- 修正指示・却下理由
  decided_by  TEXT NOT NULL DEFAULT '代表',
  decided_at  TEXT NOT NULL
)

-- KPI（施策ごと）
kpis (
  id             TEXT PRIMARY KEY,
  task_id        TEXT NOT NULL REFERENCES tasks(id),
  name           TEXT NOT NULL,     -- '見学予約数'
  unit           TEXT,              -- '件' '%' '円'
  baseline_value REAL,              -- 施策前
  target_value   REAL,              -- 目標
  actual_value   REAL,              -- 施策後（検証時に入力）
  measure_by     TEXT,              -- 測る期日
  verdict        TEXT,              -- 'continue'（続行）| 'improve'（改善）| 'stop'（中止）
  verdict_note   TEXT,
  verified_at    TEXT,
  created_at     TEXT NOT NULL
)

-- ナレッジ（同じ失敗・同じ案を繰り返さないための記憶）
knowledge (
  id           TEXT PRIMARY KEY,
  kind         TEXT NOT NULL,   -- 'success' | 'failure' | 'idea' | 'analysis' | 'learning'
  title        TEXT NOT NULL,
  body_md      TEXT NOT NULL,
  tags_json    TEXT NOT NULL,   -- ['集客','LINE',...]
  source_type  TEXT,            -- 'task' | 'analysis' | 'decision'
  source_id    TEXT,
  created_at   TEXT NOT NULL
)
```

補足
- ユーザー案の 8 テーブルに `decisions`（司令塔の判断）を足した。施策の「根拠」を残すため。
- 「タスク状態」は `projects.status`（案件全体）と `tasks.status`（施策ごと）の両方に持つ。案件の状態は施策の状態から自動更新する（例: 3 施策すべてが完了か却下なら案件も完了）。
- AI 社員カードの「現在の仕事」「過去の成果」は `analyses` / `tasks` / `outputs` を employee_id で引くだけで出せるので専用テーブルは作らない。

## 4. AI 社員間のデータフロー

Workflow「AnalysisPipeline」の流れ。各ステップは結果を D1 に保存してから次へ進む。

```
[画面] 数値と相談を入力 → 「分析開始」
   │  projects に保存（status='analyzing'）→ Workflow 起動
   ▼
Step 1  受付整理（司令塔・軽い呼び出し）
        入力内容を見て「今回必要な分析担当」を 1〜8 人選ぶ
        例: 数字だけ → データ・営業・商品 / 集客の相談 → マーケ・Web・競合
        → projects.selected_analysts_json
   ▼
Step 2  分析部（選ばれた担当を 1 人ずつ実行。各自の役割説明＋入力データ＋関連ナレッジを渡す）
        それぞれが「事実 / 仮説 / 追加で必要なデータ / 所見」を返す
        → analyses に 1 人 1 行
   ▼
Step 3  経営司令塔（統合）
        全担当の結果 ＋ ナレッジ（過去の成功・失敗・出したことのある案）を読み、
        ・結局いま何をやるべきか（要約）
        ・事実 / 仮説 / 追加データ を分けて整理
        ・最優先施策 最大 3 つ（インパクト 1〜5 ÷ 必要時間 で順位づけ、各施策の担当 AI と理由）
        ・今やらなくていいこと
        を返す → decisions に保存、tasks に最大 3 行（status='candidate'）
        案件 status='candidates'
   ▼
Step 4  実行部（施策ごとに担当 AI が成果物を作る）
        企画設計 → 目的・KPI・担当・期限・素材・手順・完了条件
        コンテンツ制作 → 公開できる原稿そのもの
        Web 実装 → 変更箇所・構成・CTA・実装仕様（必要なら Claude Code 向け指示書）
        集客実行 / LINE・営業 / 会員継続 → 具体策と文面・タイミング
        → outputs に保存。tasks.status='awaiting_approval'、案件 status='awaiting_approval'
   ▼
[画面] 代表が施策ごとに 採用 / 修正 / 却下
        採用 → tasks.status='in_progress'。KPI を設定（AI が提案した KPI を初期値に）
        修正 → 修正指示を保存 → 担当 AI が 2 版目を作成 → 再び承認待ち
        却下 → tasks.status='rejected' → knowledge に「却下した案」として記録
   ▼
[画面] 「実施した」を押す → tasks.status='awaiting_verification'
[画面] KPI の実績値を入力し、続行 / 改善 / 中止 を選ぶ → 'completed'
        → knowledge に「成功 / 失敗 / 学び」として記録（次回の司令塔が参照）
```

ナレッジの使い方（同じ案を出さない仕組み）
- 司令塔と各分析担当のプロンプトに「直近のナレッジ 30 件（題名と結果）」を毎回添える。
- 司令塔には「既出の案と同じものを出すなら、前回との違いを明記すること」と指示する。

安全設計との関係
- 実行 AI の出力は **文章・原稿・仕様書のみ**。HP 公開・広告出稿・SNS 投稿・LINE 送信・料金変更・会員データ変更の機能は Worker に一切持たせない（できない設計）。
- 施策に上記の行為が含まれる場合、`restricted_actions_json` に印を付け、画面で「代表承認が必要」と目立たせる。

## 5. API 設計（すべて `/api` 配下、JSON、Cloudflare Access 通過後のみ）

| Method | Path | 何をするか |
|---|---|---|
| GET | `/api/dashboard` | 今日の状況（分析待ち・承認待ち・実行中・検証待ち の件数）、今日の最優先 3 つ、社員の稼働状況 |
| GET | `/api/employees` | AI 社員 17 人の一覧（部署・役割・現在の仕事の有無） |
| GET | `/api/employees/:id` | 役割・見るもの・現在の仕事（進行中の分析/施策）・過去の成果（outputs） |
| POST | `/api/projects` | データ・相談を受け取り案件を作成し、Workflow を起動。案件 id を返す |
| GET | `/api/projects` | 案件の履歴一覧（`?status=` で絞り込み） |
| GET | `/api/projects/:id` | 案件の全部（進捗・分析結果・司令塔の判断・施策・成果物・承認・KPI）。画面は分析中 3 秒ごとに取得 |
| POST | `/api/projects/:id/retry` | 失敗した案件を続きから再実行 |
| POST | `/api/tasks/:id/approval` | `{decision:'adopted'|'revise'|'rejected', note?}`。修正なら担当 AI の再作成 Workflow を起動 |
| POST | `/api/tasks/:id/status` | `{status:'awaiting_verification'|'completed'}`（「実施した」「検証完了」） |
| PUT | `/api/tasks/:id/kpis` | KPI の目標を設定（複数可） |
| PATCH | `/api/kpis/:id` | 実績値・判定（続行/改善/中止）・メモを入力 |
| GET | `/api/knowledge` | ナレッジ一覧（`?kind=&tag=`） |
| GET | `/api/health` | 稼働確認（認証不要） |

## 6. 画面構成（iPad 横向き基準、黒・白・グレー）

添付いただいた「Analysis Office」のモックの情報の並び（左に目的、上に要点タイル、担当カードに「見るもの」）を土台にし、
絵文字は使わず、番号と細い罫線で落ち着いた見た目にする。

1. **ダッシュボード（トップ）**
   - 見出し「ViXer AI Company」と日付
   - 今日の状況: 分析待ち / 承認待ち / 実行中 / 検証待ち を 4 つの数字タイルで
   - ［新しい分析を開始］ボタン（大きく、白）
   - 今日の最優先 1. 2. 3.（最新案件の施策。担当・状態・タップで案件詳細へ）
   - AI 社員: 分析部 8 / 司令塔 1 / 実行部 8 をグループ分けしたカード。作業中は白い点が点滅
2. **新しい分析（入力）**
   - 対象期間、数値の入力欄（売上・会員数・新規入会・退会・問い合わせ・見学/体験・30 日お試し・本入会・その他自由）
   - 相談内容（自由記述）。CSV や表の貼り付け欄も用意
   - ［分析開始］→ 案件詳細へ移動して進捗を表示
3. **案件詳細**
   - 上部に進捗（分析中 → 施策候補 → 承認待ち → 実行中 → 検証待ち → 完了）
   - 分析結果: 担当ごとに開閉式。事実 / 仮説 / 追加データ を分けて表示
   - 経営司令塔: 要約、最優先 3 つ、今やらないこと
   - 施策カード × 最大 3: 担当 AI、根拠（インパクト・時間）、成果物（Markdown）、
     「代表承認が必要な行為」の表示、［採用］［修正］［却下］、KPI 設定、［実施した］［検証完了］
4. **AI 社員詳細（カードをタップ、右からシート表示）**
   - 役割、見るもの、現在の仕事、過去の成果（成果物一覧）
5. **履歴**: 案件一覧（状態で絞り込み）
6. **ナレッジ**: 成功 / 失敗 / 案 / 学び の一覧

## 7. MVP で作る範囲

- 上記 6 画面すべて（ただし最小限の装飾）
- AI 社員 17 人の定義とプロンプト
- Workflow による 分析 → 司令塔 → 施策 → 成果物 の自動実行
- 分析担当の自動選択、実行担当の自動割り当て
- 採用 / 修正（AI が 2 版目を作る）/ 却下
- 施策の状態管理（分析中 〜 完了、却下）
- KPI の設定と実績入力、続行 / 改善 / 中止 の記録（判断は代表が入力）
- 履歴とナレッジの保存、ナレッジの司令塔への自動参照
- Cloudflare Access による社内限定公開

## 8. MVP ではまだ作らない範囲

- KPI 検証担当 AI による自動判定（MVP は代表が判定を入力。次の版で AI 提案を追加）
- ナレッジ担当 AI による要約・整理（MVP は完了・却下時に自動で定型記録）
- 外部データの自動取り込み（Google ビジネスプロフィール、Search Console、会員管理システム、広告）
- 社員間のタスク引き継ぎ画面（司令塔が最初から適切な担当に振る）
- 複数ユーザー・権限分け（MVP は代表 1 人＋許可した数名、全員同じ権限）
- 通知（LINE / メール）、定期自動実行（毎月自動で分析）
- 外部への実行（HP 公開、広告出稿、SNS 投稿、LINE 送信）。これは方針として恒久的に人が行う

## 9. セキュリティ設計

1. **入口を閉じる**: Worker の URL 全体を Cloudflare Access（Zero Trust）で保護。許可したメールアドレスの人だけがログインできる。無料枠（50 ユーザーまで）で足りる
2. **API も二重に確認**: Access を通ると付く通行証（JWT）を Worker 側でも検証し、通行証のない API 呼び出しは拒否する
3. **秘密情報は Worker の金庫に**: AI の API キーは `wrangler secret` に保存。画面のコードや GitHub には絶対に書かない。`.dev.vars` はコミット禁止（.gitignore）
4. **AI に手足を持たせない**: Worker には HP 公開・広告・SNS・LINE・料金・会員データを操作する機能を一切実装しない。AI は文章を返すだけ
5. **承認の強制**: 上記に該当する行為を含む施策は `restricted_actions` として印を付け、必ず「代表承認待ち」で止まる
6. **個人情報を入れない運用**: 入力するのは集計値（人数・金額・率）に限る。会員名などの個人情報は入力しない旨を入力画面に明記
7. **暴走・コストの歯止め**: 同時に走る分析は 1 案件まで、AI 呼び出しは 1 案件あたり上限回数と上限トークンを設定
8. **HP と分離**: 別 Worker・別 D1・別 URL。HP の設定ファイルは一切変更しない

## 10. Cloudflare への公開方法（手順）

前提: Cloudflare アカウント（HP と同じでよい）、Node.js、Anthropic の API キー。

1. コードを取得し `ai-company/` で `npm install`
2. `npx wrangler login`（ブラウザで Cloudflare にログイン）
3. D1 を作る: `npx wrangler d1 create vixer-ai-company-db` → 表示された database_id を `wrangler.jsonc` に貼る
4. テーブルと初期データを入れる: `npx wrangler d1 migrations apply vixer-ai-company-db --remote` と seeds の適用
5. API キーを金庫に入れる: `npx wrangler secret put ANTHROPIC_API_KEY`
6. 画面を組み立てて公開: `npm run deploy`（中身は `vite build` → `wrangler deploy`）
   → `https://vixer-ai-company.<アカウント名>.workers.dev` が発行される
7. Cloudflare ダッシュボード → Zero Trust → Access → Applications で上記 URL を登録し、許可するメールアドレスを設定
8. （任意）独自ドメイン `ai.<既存ドメイン>` を Worker に割り当てる。HP のドメイン設定には触れない
9. iPad の Safari で開き、「ホーム画面に追加」するとアプリのように使える

ローカルでの動作確認: `npm run dev`（`wrangler dev` がローカル D1 と Workflow を模擬）。

## 11. 技術メモ（実装時の判断）

- 言語: TypeScript。API は Hono。画面は Vite + TypeScript（フレームワーク不使用、軽量）
- AI: Anthropic Claude（`claude-opus-5`）。JSON が必要な工程は Structured Outputs で形を固定。
  プロバイダ層の関数は `generateJSON(役割, 入力, 形)` と `generateText(役割, 入力)` の 2 つだけにし、UI と API はこれしか呼ばない
- 案件の再実行: Workflow の各ステップは「すでに保存済みなら飛ばす」ようにし、失敗時に続きから再開できる

## 12. 確認したい点

1. 配置: このリポジトリの `ai-company/` フォルダでよいか
2. AI: Anthropic Claude（`claude-opus-5`）で開始してよいか（後から差し替え可能な構造にする）
3. 認証: Cloudflare Access（推奨）でよいか。許可するメールアドレスは何件か
4. 見た目: 添付モックの並びを土台に、絵文字なし・番号と罫線の落ち着いた表現でよいか
5. KPI 検証の AI 判定は次の版でよいか（MVP は代表が入力）
