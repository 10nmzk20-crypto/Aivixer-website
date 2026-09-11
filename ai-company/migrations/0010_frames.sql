-- 経営判断の 3 軸（老子 / 孫子 / 孔子）を施策に追加する。
-- 列の追加だけで、既存のデータは書き換えない。古い施策は空欄のままになる。

-- AI が答える材料（孫子軸）
ALTER TABLE tasks ADD COLUMN head_on_competition INTEGER;
ALTER TABLE tasks ADD COLUMN uses_strength INTEGER;
ALTER TABLE tasks ADD COLUMN winnable_segment INTEGER;
ALTER TABLE tasks ADD COLUMN price_competition INTEGER;
ALTER TABLE tasks ADD COLUMN sunzi_note TEXT;

-- AI が答える材料（孔子軸）
ALTER TABLE tasks ADD COLUMN customer_trust INTEGER;
ALTER TABLE tasks ADD COLUMN staff_burden INTEGER;
ALTER TABLE tasks ADD COLUMN brand_long_term INTEGER;
ALTER TABLE tasks ADD COLUMN short_term_bias INTEGER;
ALTER TABLE tasks ADD COLUMN confucius_note TEXT;

-- アプリが計算した結果（◎ / ○ / △ / ×）
ALTER TABLE tasks ADD COLUMN laozi TEXT;
ALTER TABLE tasks ADD COLUMN sunzi TEXT;
ALTER TABLE tasks ADD COLUMN confucius TEXT;
-- 3 軸の合計点（◎3 / ○2 / △1 / ×0、最大 9）。並び順に使う
ALTER TABLE tasks ADD COLUMN frame_total INTEGER;
-- 各軸の内訳（満たした条件・満たしていない条件・上限をかけた理由）
ALTER TABLE tasks ADD COLUMN frames_json TEXT;
-- どれか 1 軸でも × のときの注意文
ALTER TABLE tasks ADD COLUMN frame_warning TEXT;
