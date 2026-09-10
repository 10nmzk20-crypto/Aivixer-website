-- Phase 2/3: KPI 検証担当の判定と、ナレッジの構造化（列とテーブルの追加のみ）
CREATE TABLE IF NOT EXISTS verifications (
  id                    TEXT PRIMARY KEY,
  task_id               TEXT NOT NULL REFERENCES tasks(id),
  version               INTEGER NOT NULL DEFAULT 1,
  achievement           TEXT NOT NULL,      -- 'achieved' | 'partial' | 'missed'
  achievement_reason    TEXT NOT NULL,
  effect_likelihood     TEXT NOT NULL,      -- 施策が効いた可能性
  other_factors         TEXT NOT NULL,      -- 他の要因の可能性
  recommendation        TEXT NOT NULL,      -- 'continue' | 'improve' | 'stop'
  recommendation_reason TEXT NOT NULL,
  next_step             TEXT NOT NULL,
  lesson                TEXT NOT NULL,
  next_time             TEXT NOT NULL,
  kpis_snapshot_json    TEXT NOT NULL,      -- 判定時の KPI（施策前・目標・施策後）
  model                 TEXT,
  input_tokens          INTEGER,
  output_tokens         INTEGER,
  created_at            TEXT NOT NULL,
  UNIQUE(task_id, version)
);
ALTER TABLE knowledge ADD COLUMN outcome   TEXT;   -- 'success' | 'failure' | 'hold'
ALTER TABLE knowledge ADD COLUMN data_json TEXT;   -- 構造化した記録（課題・当時の数字・仮説・施策・KPI・結果・学び・次回）
