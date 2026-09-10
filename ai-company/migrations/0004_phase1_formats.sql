-- Phase 1: 分析・司令塔・施策の項目を追加（既存データは残る。列の追加のみ）
ALTER TABLE analyses  ADD COLUMN actions_json TEXT;          -- 推奨アクション（最大 3）
ALTER TABLE decisions ADD COLUMN top_issue TEXT;             -- 今月の最重要課題
ALTER TABLE decisions ADD COLUMN reasoning_md TEXT;          -- そう判断した理由
ALTER TABLE tasks     ADD COLUMN what_to_do TEXT;            -- 具体的に何をするか
ALTER TABLE tasks     ADD COLUMN human_owner TEXT;           -- 人間側の担当
ALTER TABLE tasks     ADD COLUMN duration_days INTEGER;      -- 期限（日数）
ALTER TABLE tasks     ADD COLUMN difficulty INTEGER;         -- 実行難易度 1〜5
ALTER TABLE tasks     ADD COLUMN cost_estimate TEXT;         -- 必要コストの見積り
