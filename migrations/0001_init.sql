-- 自前共有マスタ（DESIGN.md §4.2 第2段）。
-- 外部APIから解決した商品のスナップショット。API が死んでも過去の解決結果は残る。
CREATE TABLE IF NOT EXISTS products (
  jan        TEXT PRIMARY KEY,
  raw_name   TEXT NOT NULL,
  brand      TEXT,
  image_url  TEXT,
  source     TEXT NOT NULL,     -- 'yahoo' | 'rakuten' | 'off'
  fetched_at INTEGER NOT NULL   -- epoch ms
);

-- 見つからなかった JAN も一定期間覚えておく。
-- 同じ未知 JAN を店頭で何度も読んだときに、毎回3つの外部APIを叩かないため。
CREATE TABLE IF NOT EXISTS misses (
  jan        TEXT PRIMARY KEY,
  checked_at INTEGER NOT NULL
);
