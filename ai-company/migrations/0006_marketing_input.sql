-- 集客データの入力拡張（列の追加のみ。既存データは変わらない）
ALTER TABLE projects ADD COLUMN period_key   TEXT;  -- '2026-08'。前月比較のために使う
ALTER TABLE projects ADD COLUMN derived_json TEXT;  -- 自動計算した KPI（コードで計算した結果）
ALTER TABLE projects ADD COLUMN funnel_json  TEXT;  -- ファネル 8 段階の判定
CREATE INDEX IF NOT EXISTS idx_projects_period ON projects(period_key);
