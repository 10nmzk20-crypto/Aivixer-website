-- ViXer AI Company — 初期テーブル定義
-- 日時はすべて ISO 8601 文字列（UTC）で保存する。

CREATE TABLE IF NOT EXISTS ai_employees (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  department    TEXT NOT NULL,            -- 'analysis' | 'command' | 'execution'
  role_summary  TEXT NOT NULL,
  watches_json  TEXT NOT NULL DEFAULT '[]',
  sort_order    INTEGER NOT NULL DEFAULT 0,
  is_active     INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS projects (
  id                     TEXT PRIMARY KEY,
  title                  TEXT NOT NULL,
  period_label           TEXT,
  input_text             TEXT NOT NULL,
  input_data_json        TEXT,
  extra_text             TEXT,
  analyst_mode           TEXT NOT NULL DEFAULT 'auto',   -- 'auto' | 'all'
  selected_analysts_json TEXT,
  selection_reason       TEXT,
  status                 TEXT NOT NULL DEFAULT 'analyzing',
  -- 'analyzing' | 'candidates' | 'awaiting_approval' | 'in_progress'
  -- | 'awaiting_verification' | 'completed' | 'rejected' | 'failed'
  workflow_instance_id   TEXT,
  error                  TEXT,
  created_at             TEXT NOT NULL,
  updated_at             TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status, created_at DESC);

CREATE TABLE IF NOT EXISTS analyses (
  id               TEXT PRIMARY KEY,
  project_id       TEXT NOT NULL REFERENCES projects(id),
  employee_id      TEXT NOT NULL REFERENCES ai_employees(id),
  status           TEXT NOT NULL DEFAULT 'running',   -- 'running' | 'done' | 'failed'
  headline         TEXT,
  facts_json       TEXT,
  hypotheses_json  TEXT,
  needed_data_json TEXT,
  findings_md      TEXT,
  model            TEXT,
  input_tokens     INTEGER,
  output_tokens    INTEGER,
  created_at       TEXT NOT NULL,
  UNIQUE(project_id, employee_id)
);
CREATE INDEX IF NOT EXISTS idx_analyses_project ON analyses(project_id);
CREATE INDEX IF NOT EXISTS idx_analyses_employee ON analyses(employee_id, created_at DESC);

CREATE TABLE IF NOT EXISTS decisions (
  id               TEXT PRIMARY KEY,
  project_id       TEXT NOT NULL REFERENCES projects(id),
  version          INTEGER NOT NULL DEFAULT 1,
  summary_md       TEXT NOT NULL,
  facts_json       TEXT NOT NULL,
  hypotheses_json  TEXT NOT NULL,
  needed_data_json TEXT NOT NULL,
  not_now_json     TEXT NOT NULL,
  model            TEXT,
  input_tokens     INTEGER,
  output_tokens    INTEGER,
  created_at       TEXT NOT NULL,
  UNIQUE(project_id, version)
);

CREATE TABLE IF NOT EXISTS tasks (
  id                      TEXT PRIMARY KEY,
  project_id              TEXT NOT NULL REFERENCES projects(id),
  decision_id             TEXT NOT NULL REFERENCES decisions(id),
  rank                    INTEGER NOT NULL,
  title                   TEXT NOT NULL,
  objective               TEXT NOT NULL,
  reasoning               TEXT NOT NULL,
  impact_score            INTEGER NOT NULL,
  effort_hours            REAL NOT NULL,
  executor_employee_id    TEXT NOT NULL REFERENCES ai_employees(id),
  assignment_reason       TEXT NOT NULL,
  restricted_actions_json TEXT NOT NULL DEFAULT '[]',
  status                  TEXT NOT NULL DEFAULT 'candidate',
  -- 'candidate' | 'awaiting_approval' | 'revising' | 'in_progress'
  -- | 'awaiting_verification' | 'completed' | 'rejected' | 'failed'
  due_date                TEXT,
  created_at              TEXT NOT NULL,
  updated_at              TEXT NOT NULL,
  UNIQUE(project_id, rank)
);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_tasks_executor ON tasks(executor_employee_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS outputs (
  id             TEXT PRIMARY KEY,
  task_id        TEXT NOT NULL REFERENCES tasks(id),
  employee_id    TEXT NOT NULL REFERENCES ai_employees(id),
  version        INTEGER NOT NULL DEFAULT 1,
  kind           TEXT NOT NULL,
  title          TEXT NOT NULL,
  content_md     TEXT NOT NULL,
  revision_note  TEXT,
  model          TEXT,
  input_tokens   INTEGER,
  output_tokens  INTEGER,
  created_at     TEXT NOT NULL,
  UNIQUE(task_id, version)
);
CREATE INDEX IF NOT EXISTS idx_outputs_employee ON outputs(employee_id, created_at DESC);

CREATE TABLE IF NOT EXISTS approvals (
  id          TEXT PRIMARY KEY,
  task_id     TEXT NOT NULL REFERENCES tasks(id),
  output_id   TEXT REFERENCES outputs(id),
  decision    TEXT NOT NULL,      -- 'adopted' | 'revise' | 'rejected'
  note        TEXT,
  decided_by  TEXT NOT NULL DEFAULT '代表',
  decided_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_approvals_task ON approvals(task_id, decided_at DESC);

CREATE TABLE IF NOT EXISTS kpis (
  id             TEXT PRIMARY KEY,
  task_id        TEXT NOT NULL REFERENCES tasks(id),
  name           TEXT NOT NULL,
  unit           TEXT,
  baseline_value REAL,
  target_value   REAL,
  actual_value   REAL,
  measure_by     TEXT,
  confirmed      INTEGER NOT NULL DEFAULT 0,   -- 0: AI の提案値 / 1: 代表が確定
  verdict        TEXT,                         -- 'continue' | 'improve' | 'stop'
  verdict_note   TEXT,
  verified_at    TEXT,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_kpis_task ON kpis(task_id);

CREATE TABLE IF NOT EXISTS knowledge (
  id           TEXT PRIMARY KEY,
  kind         TEXT NOT NULL,     -- 'success' | 'failure' | 'idea' | 'analysis' | 'learning'
  title        TEXT NOT NULL,
  body_md      TEXT NOT NULL,
  tags_json    TEXT NOT NULL DEFAULT '[]',
  source_type  TEXT,
  source_id    TEXT,
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_knowledge_kind ON knowledge(kind, created_at DESC);
