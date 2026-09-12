-- AI 社員を 18 人から 6 人（分析 5 人 + まとめ役 1 人）に絞る。
-- 分析は「1 人 1 ツール」。Search Console / GA4 / ヒートマップ / ビジネスプロフィール / 予約・入会。
--
-- 古い社員は消さずに is_active = 0 にする。過去の施策や分析の記録が
-- 担当者を参照しているため、行を消すと履歴が読めなくなる。

UPDATE ai_employees SET is_active = 0;

-- 1. 検索担当（Search Console）… サイトに来る「前」
INSERT INTO ai_employees (id, name, department, role_summary, watches_json, sort_order, is_active)
VALUES ('search', '検索担当', 'analysis',
  'Google Search Console だけを見る。どんな言葉で検索され、何位に出て、どれだけ押されたか。',
  '["検索表示回数","検索クリック数","CTR","平均掲載順位","検索キーワード別の順位"]', 1, 1)
ON CONFLICT(id) DO UPDATE SET name = excluded.name, department = excluded.department,
  role_summary = excluded.role_summary, watches_json = excluded.watches_json, sort_order = excluded.sort_order, is_active = 1;

-- 2. サイト担当（GA4）… 「何が」起きたか
INSERT INTO ai_employees (id, name, department, role_summary, watches_json, sort_order, is_active)
VALUES ('site', 'サイト担当', 'analysis',
  'Google Analytics 4 だけを見る。何人来て、どのページを見て、どのボタンが押されたか。',
  '["ユーザー数","セッション数","直帰率","平均滞在時間","見学ページ閲覧数","見学CTAクリック数","料金ページ閲覧数"]', 2, 1)
ON CONFLICT(id) DO UPDATE SET name = excluded.name, department = excluded.department,
  role_summary = excluded.role_summary, watches_json = excluded.watches_json, sort_order = excluded.sort_order, is_active = 1;

-- 3. 行動担当（ヒートマップ・録画）… 「なぜ」そうなったか
INSERT INTO ai_employees (id, name, department, role_summary, watches_json, sort_order, is_active)
VALUES ('behavior', '行動担当', 'analysis',
  'ヒートマップと録画だけを見る。どこまで読まれ、どこで迷い、どこでつまずいたか。',
  '["平均スクロール到達率","よく押されている場所","行き止まりのクリック","素早い離脱","録画で気づいたこと"]', 3, 1)
ON CONFLICT(id) DO UPDATE SET name = excluded.name, department = excluded.department,
  role_summary = excluded.role_summary, watches_json = excluded.watches_json, sort_order = excluded.sort_order, is_active = 1;

-- 4. 地図担当（Google ビジネスプロフィール）… 地図で見つけられたか
INSERT INTO ai_employees (id, name, department, role_summary, watches_json, sort_order, is_active)
VALUES ('map', '地図担当', 'analysis',
  'Google ビジネスプロフィールだけを見る。地図と検索で見つけてもらえたか、そこから何をされたか。',
  '["プロフィール表示回数","ルート検索数","電話数","Webサイトクリック数","口コミ数","平均評価"]', 4, 1)
ON CONFLICT(id) DO UPDATE SET name = excluded.name, department = excluded.department,
  role_summary = excluded.role_summary, watches_json = excluded.watches_json, sort_order = excluded.sort_order, is_active = 1;

-- 5. 予約・入会担当（予約システム・受付）… 実際にどうなったか
INSERT INTO ai_employees (id, name, department, role_summary, watches_json, sort_order, is_active)
VALUES ('booking', '予約・入会担当', 'analysis',
  '予約システムと受付の記録だけを見る。何件予約が入り、何人来て、何人が入会したか。',
  '["問い合わせ数","見学・体験予約数","実来館人数","30日お試し","本入会","退会","会員数","認知経路"]', 5, 1)
ON CONFLICT(id) DO UPDATE SET name = excluded.name, department = excluded.department,
  role_summary = excluded.role_summary, watches_json = excluded.watches_json, sort_order = excluded.sort_order, is_active = 1;

-- 6. 経営まとめ担当… 決める・作る・確かめる
INSERT INTO ai_employees (id, name, department, role_summary, watches_json, sort_order, is_active)
VALUES ('commander', '経営まとめ担当', 'command',
  '5 人分の分析を 1 つにまとめ、今やることを最大 3 つに絞る。採用された施策の成果物を作り、あとで KPI を確かめる。',
  '["5人の結論","一番詰まっている段階","改善の優先順位","今やらないこと","KPIの達成度"]', 6, 1)
ON CONFLICT(id) DO UPDATE SET name = excluded.name, department = excluded.department,
  role_summary = excluded.role_summary, watches_json = excluded.watches_json, sort_order = excluded.sort_order, is_active = 1;
