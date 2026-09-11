-- 社員構成を 18 名に（検証部を新設し、改善担当を追加）。既存の社員 ID は変えない。
UPDATE ai_employees SET name = '経営統合・振り分け担当' WHERE id = 'commander';
UPDATE ai_employees SET department = 'verification', sort_order = 16 WHERE id = 'kpi';
UPDATE ai_employees SET department = 'verification', sort_order = 18 WHERE id = 'knowledge';
INSERT OR REPLACE INTO ai_employees (id, name, department, role_summary, watches_json, sort_order, is_active) VALUES
('improve', '改善担当', 'verification', 'うまくいかなかった施策を作り直す。やめるのか、形を変えて再実施するのかを整理する。',
 '["未達だったKPI","実施内容","想定と結果のずれ","かけた時間と費用"]', 17, 1);

-- ChatGPT 用レポートの保存
CREATE TABLE IF NOT EXISTS reports (
  id           TEXT PRIMARY KEY,
  project_id   TEXT NOT NULL REFERENCES projects(id),
  version      INTEGER NOT NULL DEFAULT 1,
  period_label TEXT,
  content      TEXT NOT NULL,   -- ChatGPT に貼り付ける全文
  char_count   INTEGER NOT NULL,
  created_at   TEXT NOT NULL,
  UNIQUE(project_id, version)
);
CREATE INDEX IF NOT EXISTS idx_reports_project ON reports(project_id, created_at DESC);
