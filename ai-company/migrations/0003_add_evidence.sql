-- 分析結果と司令塔の判断に「根拠となった数字」を追加
ALTER TABLE analyses ADD COLUMN evidence_json TEXT;
ALTER TABLE decisions ADD COLUMN evidence_json TEXT;
