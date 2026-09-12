-- MVP を「数字を入れる → 分析される → 次に何をすべきか分かる」に絞る。
-- 5 人分の分析結果と、今月やるべきこと（最大 3 つ）を案件に保存する。
-- 列の追加だけ。施策・承認・KPI・ナレッジの表は残すが、画面と API からは外す。

ALTER TABLE projects ADD COLUMN review_json TEXT;

-- AI 社員をツール名に揃え、まとめ役は置かない（総合レポートはアプリが計算する）
UPDATE ai_employees SET is_active = 0;

INSERT INTO ai_employees (id, name, department, role_summary, watches_json, sort_order, is_active)
VALUES ('search', 'Search Console 担当', 'analysis',
  'Google Search Console だけを見る。どんな言葉で検索され、何位に出て、どれだけ押されたか。',
  '["検索表示回数","検索クリック数","CTR","平均掲載順位","キーワード別の順位"]', 1, 1)
ON CONFLICT(id) DO UPDATE SET name = excluded.name, role_summary = excluded.role_summary,
  watches_json = excluded.watches_json, sort_order = excluded.sort_order, is_active = 1;

INSERT INTO ai_employees (id, name, department, role_summary, watches_json, sort_order, is_active)
VALUES ('map', 'Google ビジネスプロフィール担当', 'analysis',
  'Google ビジネスプロフィールだけを見る。地図と検索で見つけてもらえたか、そこから何をされたか。',
  '["表示回数","ルート検索数","電話数","Webサイトクリック数","口コミ件数","平均評価"]', 2, 1)
ON CONFLICT(id) DO UPDATE SET name = excluded.name, role_summary = excluded.role_summary,
  watches_json = excluded.watches_json, sort_order = excluded.sort_order, is_active = 1;

INSERT INTO ai_employees (id, name, department, role_summary, watches_json, sort_order, is_active)
VALUES ('site', 'GA4 担当', 'analysis',
  'Google Analytics 4 だけを見る。何人来て、どのページを見て、どのボタンが押されたか。',
  '["ユーザー数","トップ/料金/見学ページ閲覧数","見学CTAクリック数","流入経路"]', 3, 1)
ON CONFLICT(id) DO UPDATE SET name = excluded.name, role_summary = excluded.role_summary,
  watches_json = excluded.watches_json, sort_order = excluded.sort_order, is_active = 1;

INSERT INTO ai_employees (id, name, department, role_summary, watches_json, sort_order, is_active)
VALUES ('behavior', 'Clarity 担当', 'analysis',
  'Microsoft Clarity だけを見る。どこまで読まれ、どこで迷い、どこでつまずいたか。',
  '["平均スクロール率","CTA到達率","デッドクリック","レイジクリック","録画の所見"]', 4, 1)
ON CONFLICT(id) DO UPDATE SET name = excluded.name, role_summary = excluded.role_summary,
  watches_json = excluded.watches_json, sort_order = excluded.sort_order, is_active = 1;

INSERT INTO ai_employees (id, name, department, role_summary, watches_json, sort_order, is_active)
VALUES ('booking', 'hacomono 担当', 'analysis',
  'hacomono と受付の記録だけを見る。何件予約が入り、何人来て、何人が入会したか。',
  '["問い合わせ","見学・体験予約","実来館","30日お試し","本入会","退会","会員数"]', 5, 1)
ON CONFLICT(id) DO UPDATE SET name = excluded.name, role_summary = excluded.role_summary,
  watches_json = excluded.watches_json, sort_order = excluded.sort_order, is_active = 1;
