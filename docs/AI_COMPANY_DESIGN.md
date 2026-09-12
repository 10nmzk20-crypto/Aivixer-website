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

## 13. 実装メモ（設計からの変更点）

- 役割プロンプトは 1 人 1 ファイルではなく、部署ごとの 3 ファイル（`src/employees/prompts-analysis.ts` / `prompts-command.ts` / `prompts-execution.ts`）にまとめた。
- AI 社員の初期データは `seeds/` ではなく `migrations/0002_seed_employees.sql` に置き、`wrangler d1 migrations apply` 1 回で済むようにした。
- `kpis` に `confirmed`（AI の提案値か、代表が確定した値か）を追加。`projects` に `extra_text`（貼り付けデータ）と `analyst_mode`（自動 / 全員）を追加。
- API を追加: `POST /api/projects/:id/cancel`（止まった分析の中止）、`GET /api/projects/metrics`（入力項目）、`POST /api/knowledge`（学びの手動追加）、`/api/auth/*`。
- 認証は Cloudflare Access に加えて共有パスワード方式も選べる。どちらも未設定の本番環境では API を拒否する。
- 実行担当の成果物作成と分析担当の分析は Workflow 内で並行実行し、所要時間を短縮した。
- 動作確認用に `AI_PROVIDER=mock`（固定回答）を用意した。
- 分析結果と司令塔の判断に「根拠となった数字」（label / value / source）を追加し、事実 / 仮説 / 根拠となった数字 / 追加で必要なデータ の 4 区分で表示する（`migrations/0003_add_evidence.sql`）。
- 実 AI との通信を公開前に確かめる `npm run ai:check` を追加。
- 案件詳細画面の分析担当名は D1 の社員データから取得する（コード内の固定データを廃止）。

## 14. Phase 1〜3 の実装（実運用向けの強化）

**Phase 1: 招集と回答フォーマット**
- 経営司令塔が相談を分類し、分析担当を 2〜4 名だけ招集する（上限を 8 → 4 に変更）。案件詳細に「今回招集された AI 社員」を表示。
- 分析担当の回答を 6 区分に統一: 結論 / 確認できる事実 / 仮説（最大 3・根拠つき）/ 根拠となった数字 / 不足データ / 推奨アクション（最大 3）。
- 司令塔の回答を 5 区分に統一: 今月の最重要課題 / そう判断した理由 / 今やること（最大 3）/ 今はやらないこと / 追加で必要なデータ。
- 施策に what_to_do（具体的に何をするか）、human_owner（人間側の担当）、duration_days（期限）、difficulty（難易度）、cost_estimate（コスト）を追加（`migrations/0004`）。
- `AI_PROVIDER` は `claude` と `mock` で切り替え（`anthropic` も同義）。画面左下に現在の AI モードを表示。

**Phase 2: 実行管理と KPI 検証**
- `verifications` テーブルと `VerificationPipeline` を追加（`migrations/0005`）。KPI 検証担当 AI が 達成 / 一部達成 / 未達 を判定し、効いた可能性・他の要因・続行 / 改善 / 中止 の推奨・次の一手・学び・次回の対応を返す。
- `POST /api/tasks/:id/verify-ai` で判定を依頼。最終判断は代表が行う（AI の推奨は初期選択として表示）。
- ダッシュボードに「実行中・検証待ちの施策」一覧を追加。

**Phase 3: ナレッジの構造化と再利用**
- `knowledge` に `outcome`（成功 / 失敗 / 保留）と `data_json`（課題・当時の数字・仮説・施策・KPI・結果・学び・次回の対応・日付）を追加。
- 検証完了時に構造化して自動保存。ナレッジ画面で KPI 表つきで表示。
- 分析担当と司令塔へ渡すナレッジを、今回の相談と語が重なる順に並べ替え、上位 5 件は施策・KPI・結果・学びまで含めて渡す。

## 15. 集客データ入力とファネル分析（Phase 1〜5）

**Phase 1: 入力項目のブロック化（`src/metrics.ts`）**
- 7 ブロック（基本 / 見学・体験予約 / Google ビジネスプロフィール / Search Console / GA4 / ヒートマップ / 認知経路）に整理し、計 52 項目を定義。各項目に `source`（どの計測ツールの数字か）を持たせ、将来の API 連携の取り込み先とする。
- 検索キーワードは何件でも追加・削除できる表として入力（キーワード名は固定しない）。ヒートマップの所見は自由記述で保存し、AI 分析にも渡す。
- 保存形式を `{values, keywords, notes}` に変更。`normalizeInputData` が旧形式（平らな JSON）も読むため、既存データは壊れない。
- 入力画面はアコーディオン。最初は基本ブロックのみ開く。ブロックごとに入力済み件数を表示。

**Phase 2: 自動計算と前月比較（`src/analysis/derived.ts` / `compare.ts`）**
- 12 個の KPI をコードで計算。分母が 0 か未入力なら計算せず、不足している項目名を返す。
- `projects.period_key`（`2026-08`）を追加し、同じ形式の前月案件を自動で探して比較。増減数・増減率・過去 3 か月平均・6 か月平均を算出（`migrations/0006`）。

**Phase 3: ファネル判定（`src/analysis/funnel.ts`）**
- 8 段階を 良好 / 注意 / 問題あり / データ不足 で判定。前月比があれば前月比で、無ければ率の目安で判定する。
- 各段階に `severity`（前月比の下落幅）を持たせ、「問題あり」の中で悪化が最大の段階を「最も詰まっている可能性」とする。
- 判定結果は `projects.funnel_json` に保存し、案件詳細の先頭にカード表示する。

**Phase 4: AI への受け渡し（`formatInput` の書き換え）**
- ブロックごとに数字を整理し、自動計算 KPI（計算式つき）、計算できなかった KPI とその理由、前月比較、ファネル判定、ヒートマップ所見を添える。
- 末尾に「入力されていない数字は作らない」「Search Console / GA4 / ビジネスプロフィールの数字は集計方法が違うので同一視しない」「自分で率を計算しない」を明記。

**Phase 5: 招集と統合**
- 司令塔の招集プロンプトに、ファネル判定の「問題あり」段階から招集先を決めるルールを追加（検索・MEO → マーケ / Web / 競合、HP 内 → Web / マーケ、見学以降 → 営業 / 継続 / 商品）。
- マーケ分析担当のプロンプトに、ViXer の集客導線とファネル判断の型（露出低下 / HP の訴求 / 見学後の営業 / お試し中のサポート）を追加。結論に「集客総合評価」と「最も問題がある場所」を必ず含める。

## 16. 採用 → 実行担当への引き継ぎ（MVP を実運用に）

**成果物を作るタイミングの変更**
- 分析パイプラインは施策案（最大 3 件）を作った時点で止まり、`awaiting_approval` にする。成果物は作らない。
- 代表が「採用」を押すと `ExecutionPipeline` が起動し、担当の実行 AI が成果物を作る（`producing` → `in_progress`）。
- 「修正」は `PlanRevisionPipeline` を起動し、経営司令塔が施策案そのものを作り直す（`plan_revising` → `awaiting_approval`、`plan_version` が増える）。
- 成果物ができた後の修正は `POST /api/tasks/:id/revise-output`（`RevisionPipeline`）。作成に失敗したときは `POST /api/tasks/:id/retry-production` で再依頼。
- 施策の状態: candidate → awaiting_approval → (採用) producing → in_progress → awaiting_verification → verifying → completed / rejected。修正系は plan_revising と revising。

**数字の捏造防止（`src/analysis/verify-numbers.ts`）**
- AI の結論・事実・根拠の数字を、入力値・計算済み KPI・キーワードの数字・入力値どうしの和と突き合わせる。
- 見つからない数字は `analyses.unverified_json` に保存し、案件詳細に警告として表示する。年号や小さい序数は照合対象から除く。

**本番での固定回答の禁止（`src/ai/provider.ts`）**
- `ENVIRONMENT` が `development` 以外で `AI_PROVIDER=mock` なら、分析開始時に再試行なしのエラーにする。

`migrations/0007` は列の追加のみ（tasks に plan_version / plan_change_note / production_error / adopted_at、analyses に unverified_json）。

## 17. 外部 AI を使わない運用と ChatGPT 用レポート

**方針の変更**: 現時点では Claude / OpenAI の API を接続せず、アプリは「入力 → 保存 → KPI 計算 → 分析材料の整理 → ChatGPT 用レポート生成」までを担う。文章による分析は、生成したレポートを ChatGPT に貼り付けて行う。

- `AI_PROVIDER=none` を既定にした。分析開始は入力・KPI・ファネル判定の保存だけで完了し、案件は `ready_for_report` になる。AI 接続用のコード（Claude プロバイダ、各パイプライン）は残してあり、`AI_PROVIDER=claude` に変えれば元の自動分析に戻る。
- 社員構成を 18 名に。検証部（KPI 検証・改善・ナレッジ）を新設し、改善担当を追加。司令塔を「経営統合・振り分け担当」に改名（`migrations/0008`）。
- `src/employees/guides.ts` に社員ごとの 役割 / 見るべきデータ / 判断ポイント / 必要な入力データ を定義し、社員シートに表示する。
- KPI を追加: 問い合わせ → 見学率、見学 → 本入会率（直接 + お試し経由）、会員の純増減、認知経路と予約経路の比率。
- 前年同月比を追加（`lastYearPeriodKey`）。過去 13 か月分を読み、前月と前年同月の両方と比べる。純増減のように負になりうる値では増減率を出さない。
- `src/report/build.ts` がレポートを組み立てる。16 章構成で、未入力は「データなし」と明記し、末尾に ChatGPT への依頼文を付ける。
- `reports` テーブルに版ごとに保存。案件詳細で作成・表示・全文コピー・履歴の切り替えができる。コピーは Clipboard API を使い、失敗する環境では表示中のテキスト欄を選択する方法に切り替える（iPad Safari 対策）。
- レポート作成時に KPI と比較を計算し直し、案件にも保存する。過去月を後から入力した場合も最新の比較で作られる。

## 18. 会社の憲法と「仕組みスコア」（人のエネルギーで施策を評価する）

**方針の変更**: ViXer が目指す姿を「小さく、強く、暇な会社」と定め、これを全社員（分析部・司令塔・実行部・検証部）の最上位ルールにした。施策は「効果がありそうか」だけでなく「人間のエネルギーを増やさないか」でも評価する。

### 憲法（`src/principles.ts`）

すべての AI 社員のシステムプロンプトの先頭に `PRINCIPLES_PROMPT` を差し込み、ChatGPT 用レポートの冒頭（`## 0. 判断の前提`）にも同じ内容を出す。判断の基準を、画面・AI・ChatGPT の 3 か所で揃えるため。

- `VISION` … 「小さく、強く、暇な会社」
- `GOAL_STATES` … 目指す 6 つの状態（集客が続く / 会員が自分で使える / 入会しやすい / 継続しやすい / スタッフの仕事が増えない / 代表の判断量が減る）
- `PRINCIPLES` … 憲法 10 か条
- `TASK_TYPES` … A / B / C の分類
- `DISCOURAGED_PATTERNS` … 安易な第一提案にしてはいけない 9 種（個別 LINE、声かけ、毎日投稿、営業トーク改善、人力集計 など）。判定用の正規表現を持つ
- `PREFERRED_DIRECTIONS` … ViXer が優先したい 17 の方向（SEO 記事、GBP の資産化、FAQ、セルフメニュー、摩擦削減、自動化 など）

### A / B / C 分類

| 分類 | 意味 | 扱い |
|---|---|---|
| A | 一度作れば繰り返し働く | 最優先 |
| B | 定期メンテナンスのみ必要 | 次点 |
| C | 毎回人が動かなければ成立しない | 原則として優先度を下げる |

C を提案する場合は「なぜ人手が必要なのか」「仕組み化できない理由」（`manual_reason`）の記載を必須にした。

### 仕組みスコア（`src/analysis/leverage.ts`）

計算はすべてコードで行う。AI には数字を計算させない。

```
（効果 × 資産性 × 自動化）÷（初期工数 + 継続工数 × 12 + 人的依存度 × 2 + 1）
```

分子は「将来も働き続ける度合い」、分母は「人間のエネルギー」。人的依存度はスタッフ依存と代表依存の平均。施策案はこのスコア順に並べ替えてから順位を付ける。

さらに、AI の自己申告をコード側で検算する。

- `checkType()` … 継続工数が月 4 時間以上、またはスタッフ依存が 4 以上なら A → B に降格。継続工数が月 12 時間以上なら B → C に降格。降格したときは理由（`type_note`）を画面に出す
- `findDiscouraged()` … 抑制対象の施策が含まれていないかを文単位で見る。「声かけを増やす**より**、自分で選べる状態を作る」のように、その手法を否定している文は数えない（`NEGATION_RE`）
- `leverageWarning()` … 抑制対象が含まれているのに C 以外、または C でも理由が無い場合に注意文を出す

動作確認は `npm run leverage:check`（15 項目）。

### 社員の役割の作り直し（`migrations/0009`）

実行部と検証部の 6 名を「仕組みを作る役」に読み替えた。人数は増やしていない。

| ID | 旧 | 新 |
|---|---|---|
| planner | 企画設計担当 | 仕組み設計担当 |
| content | コンテンツ制作担当 | 資産コンテンツ担当 |
| growth | 集客実行担当 | 資産型集客担当 |
| line | LINE・営業担当 | 摩擦削減担当 |
| retention | 会員継続担当 | セルフ利用設計担当 |
| improve | 改善担当 | 自動化・改善担当 |

D1 側（`migrations/0009`）とコード側（`src/employees/roster.ts`、`prompts-command.ts`）の両方を揃えてある。片方だけ変えると、社員一覧と施策カードで違う名前が出る。

### 画面表示

施策カード（案件詳細・ダッシュボード）に次を出す。

- A / B / C バッジ。A は白地に黒（強調）、C は破線の枠
- 「人の仕事が増える / 減る」のチップ。**増える**ときは反転表示にして目立たせる
- 仕組みスコアと計算式（マウスを乗せると式が出る）
- 初期工数・継続工数・資産性・自動化・自己解決・スタッフ依存・代表依存の 7 項目
- 分類を降格した理由、人手が必要な理由、注意文

### ChatGPT 用レポート

- 冒頭に `## 0. 判断の前提（ViXer の方針）` を追加し、憲法と A/B/C の説明を載せる
- 末尾の依頼文を差し替え。「小さく、強く、暇な会社」と 9 つの条件、①最大の問題 〜 ⑦次回確認する KPI の出力指定、A/B/C の凡例、「一般的な『LINEで声かけ』『SNS投稿を増やす』『営業トーク改善』を安易に第一提案にしないでください」を含む
- 過去の施策欄に `[A]` `[B]` `[C]` と「人の仕事」を併記する
- 「15. 現在追いかけている KPI」は、今回の案件で採用した施策も対象にする（`listActiveTasksForReport`）

## 19. 経営判断の 3 軸（老子 / 孫子 / 孔子）

**方針の追加**: 施策の評価軸を 1 本から 3 本にした。これまでの「仕組みスコア」は人的コストだけを見ており、「競合と正面衝突していないか」「信頼が積み上がるか」を見ていなかった。名言の引用ではなく、施策を見るときの観点として実装する。

| 軸 | 役割 | 見るもの |
|---|---|---|
| 老子 | 運営思想 | 人が頑張らなくても自然に回るか。無駄を減らす |
| 孫子 | 競争戦略 | 正面衝突を避け、勝てる場所を選べているか |
| 孔子 | 信頼・組織・ブランド | 短期利益より、長期の信頼が積み上がるか |

### 記号を決めるのはコード（`src/analysis/frames.ts`）

AI に「◎です」と言わせない。AI が答えるのは材料となる数字だけで、◎ / ○ / △ / × を決めるのはアプリ。同じ数字なら誰が見ても同じ評価になり、後から理由を説明できる。

**老子軸** … 既存の数字だけで判定する（AI への追加質問なし）

| 条件 |
|---|
| 人が毎回動かなくてよい（継続工数が月 2 時間未満 かつ スタッフ依存 2 以下） |
| 一度作れば何度も働く（資産性 4 以上） |
| 自動化できる（自動化 3 以上） |
| 会員が自己解決できる（自己解決 4 以上） |
| 代表の判断を毎回必要としない（代表依存 2 以下） |

5 個 → ◎ / 4 個 → ○ / 2〜3 個 → △ / 0〜1 個 → ×

**孫子軸** … `head_on_competition`（大手と同じ土俵の度合い）、`uses_strength`、`winnable_segment`、`price_competition` を AI に答えさせ、「広告費・人員の大量投入が要らない（初期工数 40h 以下）」を加えた 5 条件で判定する。

**孔子軸** … `customer_trust`、`staff_burden`、`brand_long_term`、`short_term_bias` の 4 条件で判定する。

### 上限ルール（数字が良くても上げない）

| 条件 | 結果 |
|---|---|
| C 分類（毎回人が動く） | 老子は △ 止まり |
| 価格競争になっている | 孫子は △ 止まり |
| 大手と同じ土俵（4 以上） | 孫子は △ 止まり |
| 短期利益偏重 | 孔子は △ 止まり |
| 社員負担 4 以上 | 孔子は △ 止まり |

### 並び順への反映

`compareForRanking()` が施策の順位を決める。

1. **どれか 1 軸でも × がある施策は、いちばん下に落とす**
2. 残りは 3 軸の合計点（◎3 / ○2 / △1 / ×0、最大 9 点）の高い順
3. 同点なら仕組みスコアの高い順

これにより「人は楽だが大手と正面衝突する施策」「効率は良いが信頼を損なう施策」が上位に来なくなる。動作確認では、仕組みスコア 20 の値下げ施策（孫子 × 孔子 ×）が、スコア 2.5 のセルフメニュー（3 軸とも ◎）より下に落ちることを確認している。

### 画面

施策カードに 1 行だけ足す。思想名は装飾せず、記号だけを読ませる。

```
A   老子 ◎   孫子 ◎   孔子 ○   人的負担 ↓   資産性 高
```

- 記号に触れると、満たしている条件・満たしていない条件・上限をかけた理由が出る
- **× は反転表示**にして、ひと目で「この軸に反する」と分かるようにする
- 孫子・孔子について AI が書いた 1〜2 文の補足を下に出す
- ダッシュボードの最優先リストにも `老子 ◎ 孫子 ◎ 孔子 ◎` を並べる

### DB（`migrations/0010`）

列の追加のみ。既存データは書き換えないので、3 軸が付く前の施策は空欄のままになり、カードにもその行は出ない。

- AI が答える材料: `head_on_competition` / `uses_strength` / `winnable_segment` / `price_competition` / `sunzi_note` / `customer_trust` / `staff_burden` / `brand_long_term` / `short_term_bias` / `confucius_note`
- アプリが計算した結果: `laozi` / `sunzi` / `confucius` / `frame_total` / `frames_json` / `frame_warning`

### 経営司令塔の最終出力

代表が受け取るのは施策ごとの 13 項目（最大の問題 / 原因仮説 / 施策最大 3 つ / A・B・C / 老子 / 孫子 / 孔子 / 初期工数 / 継続工数 / 人の仕事の増減 / 自動化可能性 / 長期資産になるか / 今やらないこと）。4〜7 はアプリが計算するため、司令塔には記号を書かせない。

### ChatGPT 用レポート

- `## 0. 判断の前提` に 3 軸の説明を追加
- 末尾の依頼文を 3 軸版に差し替え（①最大の問題 〜 ⑩次回確認する KPI）
- 過去の施策に `3 軸: 老子 ◎ / 孫子 ◎ / 孔子 ○` を併記

動作確認は `npm run frames:check`（13 項目）。ご指定の提案例 3 つと同じ評価が出ることを確かめている。


## 20. AI 社員を 6 人に絞る（1 人 1 ツール）

**方針の変更**: 18 人体制は役割が重なり、誰がどの数字を見ているのかが分かりにくくなっていた。分析に使うツールは 5 つと決まっているので、**1 ツール 1 担当**にして 6 人（分析 5 + まとめ 1）にした。

| id | 名前 | 見るツール | 答える問い |
|---|---|---|---|
| `search` | 検索担当 | Google Search Console | どんな言葉で検索され、何位だったか |
| `map` | 地図担当 | Google ビジネスプロフィール | 地図で見つけてもらえたか |
| `site` | サイト担当 | Google Analytics 4 | 何人来て、どこを見て、何を押したか |
| `behavior` | 行動担当 | ヒートマップ・録画 | なぜそこで止まったか |
| `booking` | 予約・入会担当 | 予約システム・受付 | 実際に予約・入会したか |
| `commander` | 経営まとめ担当 | 上の 5 人の結果 | 結局、今何をやるべきか |

実行部・検証部は無くした。成果物を作るのも KPI を確かめるのも `commander` が受け持つ（`EXECUTION_PROMPTS.produce` / `.verify` を `system()` の override として渡す）。

### 招集を AI に選ばせるのをやめた

以前は司令塔が「今回必要な担当を 2〜4 名選ぶ」ために AI を 1 回呼んでいた。1 人 1 ツールになったので、**入力された数字を見れば誰を呼ぶかは決まる**。`ownersWithData()`（`src/metrics.ts`）が入力ブロックから担当を割り出す。

- AI の呼び出しが 1 回減り、失敗する箇所も 1 つ減った
- 数字が 1 つも入っていないツールの担当は呼ばない。言えることが無いため
- 数字が無く相談文だけの場合は、結果を持っている予約・入会担当だけが見る

`SelectAnalystsSchema` と `COMMANDER_PROMPTS.select` は削除した。

### 入力画面とレポートを 5 つのツール順に

`METRIC_GROUPS` を集客の流れ順（① 検索 → ② 地図 → ③ サイト → ④ 行動 → ⑤ 予約・入会）に並べ替え、各ブロックの見出しに担当名を出す（`GROUP_OWNER` / `OWNER_QUESTION`）。ChatGPT 用レポートの見出しにも「担当」と「答える問い」を入れた。

### 過去の記録

`migrations/0011` は古い社員を消さずに `is_active = 0` にする。行を消すと、その社員を参照している過去の施策・分析が読めなくなるため。コード側にも `LEGACY_NAMES` を置き、古い id は「資産コンテンツ担当（旧）」のように表示する。社員がいない部署はダッシュボードに見出しごと出さない。

## 21. MVP の確定（Web マーケ分析に絞る）

**方向性の確定**: ViXer AI Company は「Web マーケティング分析ツール」とする。MVP は **数字を入れる → 分析される → 次に何をすべきか分かる** の 1 本だけ。

### AI 社員 5 人（まとめ役は置かない）

| id | 名前 | ツール |
|---|---|---|
| `search` | Search Console 担当 | Google Search Console |
| `map` | Google ビジネスプロフィール担当 | Google ビジネスプロフィール |
| `site` | GA4 担当 | Google Analytics 4 |
| `behavior` | Clarity 担当 | Microsoft Clarity |
| `booking` | hacomono 担当 | hacomono・受付 |

5 人分をまとめた「今月やるべきこと」はアプリが計算するため、まとめ役の社員は置かない。

### 分析はアプリが行う（`src/analysis/tool-review.ts`）

外部 AI を使わないので、「現状・傾向・問題点・改善案」はコードが数字から組み立てる。各担当の判断の目安を、そのままルールにした。

- `current` … 入力値と計算値をそのまま並べる
- `trend` … 前月比（前月の入力があるときだけ）
- `findings` … `{ problem, fix, weight }`。weight は深刻さ（3 / 2 / 1）
- `missing` … 判断に足りなかった数字
- `verdict` … findings の最大 weight から `good` / `watch` / `problem` / `no_data`

**今月やるべきこと**は weight 順に最大 3 つ。同じ weight なら集客の流れの上流（検索 → 地図 → サイト → 行動 → 予約入会）を先にする。**同じ担当から 2 つ以上は選ばない**ので、1 か所に偏らない。

しきい値は誤検知が出ないよう相対値にしてある。例えばデッドクリックは「0 より多い」ではなく「本物のボタンが押された回数の 3 割以上」で拾う。動作確認は `npm run review:check`（16 項目）。

### 分析はワークフローを使わない

案件の作成時（`POST /api/projects`）に `reviewAll()` を呼び、`projects.review_json` に保存して `status = 'reviewed'` にする。外部 AI を呼ばないので待つ理由がなく、保存した時点で分析は終わっている。Workflow は MVP の経路では使わない。

### 画面は 3 つ

ダッシュボード / 新しい分析 / 分析結果。ナレッジ画面は削除。分析結果は上から「今月やるべきこと（最大 3 つ）」→「担当ごとの分析」→「（任意）ChatGPT 用レポート」。担当ブロックは最初は閉じており、いちばん詰まっている 1 つだけ開く。

### 外した機能

施策管理・タスク管理・ナレッジ・承認・KPI 検証は、`src/api/app.ts` の route 登録から外した。**コードと D1 の表は残している**。消すと過去の記録が読めなくなるうえ、外部 AI を接続して再開するときに作り直しになるため。`EXECUTOR_IDS` は空配列にしてある。
