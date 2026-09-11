-- 採用 → 実行担当への引き継ぎ（列の追加のみ。既存データは変わらない）
ALTER TABLE tasks ADD COLUMN plan_version      INTEGER NOT NULL DEFAULT 1;  -- 施策案の版（修正のたびに増える）
ALTER TABLE tasks ADD COLUMN plan_change_note  TEXT;                        -- 前の案から何を変えたか
ALTER TABLE tasks ADD COLUMN production_error  TEXT;                        -- 成果物の作成に失敗した理由
ALTER TABLE tasks ADD COLUMN adopted_at        TEXT;                        -- 採用した日時
ALTER TABLE analyses ADD COLUMN unverified_json TEXT;  -- 入力に見つからなかった数字（AI の捏造チェック）
