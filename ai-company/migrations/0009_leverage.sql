-- 施策を「人の仕事を増やさず、将来も働き続ける仕組みか」で評価するための列（追加のみ）
ALTER TABLE tasks ADD COLUMN task_type         TEXT;      -- 'A' | 'B' | 'C'
ALTER TABLE tasks ADD COLUMN type_note         TEXT;      -- 分類を補正した理由
ALTER TABLE tasks ADD COLUMN initial_hours     REAL;      -- 初期工数（時間）
ALTER TABLE tasks ADD COLUMN ongoing_hours     REAL;      -- 継続工数（月あたりの時間）
ALTER TABLE tasks ADD COLUMN automation_score  INTEGER;   -- 自動化可能性 1〜5
ALTER TABLE tasks ADD COLUMN asset_score       INTEGER;   -- 資産性 1〜5
ALTER TABLE tasks ADD COLUMN self_service      INTEGER;   -- 会員の自己解決度 1〜5
ALTER TABLE tasks ADD COLUMN staff_dependency  INTEGER;   -- スタッフ依存度 1〜5
ALTER TABLE tasks ADD COLUMN owner_dependency  INTEGER;   -- 代表依存度 1〜5
ALTER TABLE tasks ADD COLUMN human_work_change TEXT;      -- 'decrease' | 'same' | 'increase'
ALTER TABLE tasks ADD COLUMN human_work_note   TEXT;      -- 人の仕事がどう変わるか（説明）
ALTER TABLE tasks ADD COLUMN manual_reason     TEXT;      -- C 分類のとき、なぜ人手が必要か
ALTER TABLE tasks ADD COLUMN leverage_score    REAL;      -- 仕組みスコア（コードが計算）
ALTER TABLE tasks ADD COLUMN leverage_formula  TEXT;      -- スコアの計算式
ALTER TABLE tasks ADD COLUMN leverage_warning  TEXT;      -- 憲法に照らした注意

-- 実行部・検証部の役割名を、仕組み化の考え方に寄せる（id は変えないので既存データに影響しない）
UPDATE ai_employees SET name = '仕組み設計担当',       role_summary = '人が繰り返している仕事を見つけ、なくす・自動化・テンプレ化・セルフ化のどれかに変える。採用された施策を実行できる形に分解する。' WHERE id = 'planner';
UPDATE ai_employees SET name = '資産コンテンツ担当',   role_summary = '一度作れば働き続ける文章を作る。記事・FAQ・ガイド・Google 投稿など、積み上がるものを優先する。' WHERE id = 'content';
UPDATE ai_employees SET name = 'Web 実装担当',         role_summary = 'HP・LP の導線を直し、迷いと手間を減らす。変更箇所・構成・UI・CTA・実装仕様を作る。' WHERE id = 'webdev';
UPDATE ai_employees SET name = '資産型集客担当',       role_summary = 'SEO・MEO・Google ビジネスプロフィール・口コミ・比較ページなど、積み上がる集客導線を作る。' WHERE id = 'growth';
UPDATE ai_employees SET name = '摩擦削減担当',         role_summary = '見学・入会・予約・利用・相談・継続の中にある面倒・不安・迷いを減らす。人の声かけを増やさずに解決する。' WHERE id = 'line';
UPDATE ai_employees SET name = 'セルフ利用設計担当',   role_summary = '会員がスタッフに聞かなくても、自分で運動・予約・相談・利用方法を理解できる仕組みを設計する。' WHERE id = 'retention';
UPDATE ai_employees SET name = '自動化・改善担当',     role_summary = '集計・レポート・タスク管理・定型処理を自動化する。うまくいかなかった施策を作り直す。' WHERE id = 'improve';

UPDATE ai_employees SET watches_json = '["繰り返している作業","なくす/自動化/テンプレ化/セルフ化","目的","KPI","期限","完了条件"]' WHERE id = 'planner';
UPDATE ai_employees SET watches_json = '["SEO記事","FAQ","利用ガイド","Google投稿","HP文章","再利用できる素材"]' WHERE id = 'content';
UPDATE ai_employees SET watches_json = '["変更箇所","構成","UI","CTA","見学予約導線","離脱ポイント"]' WHERE id = 'webdev';
UPDATE ai_employees SET watches_json = '["SEO","MEO","Googleビジネスプロフィール","口コミ","比較ページ","検索で見つかる仕組み"]' WHERE id = 'growth';
UPDATE ai_employees SET watches_json = '["見学前の不安","入会の手間","予約・変更のしやすさ","問い合わせの多い質問","館内の迷い"]' WHERE id = 'line';
UPDATE ai_employees SET watches_json = '["目的別セルフメニュー","20分/30分/45分","初心者ガイド","自己解決できるページ","館内の案内"]' WHERE id = 'retention';
UPDATE ai_employees SET watches_json = '["集計の自動化","レポートの自動生成","定型処理","未達だったKPI","繰り返し発生する作業"]' WHERE id = 'improve';
