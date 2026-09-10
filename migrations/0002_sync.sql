-- 差分同期（DESIGN.md §6.2 の /sync、§8 Phase 2）。ユーザーの全記録（商品・購入・評価・カテゴリ）の控え。
-- 中身は JSON のまま持つ。判定はクライアントで完結し、サーバーは中身を検索しないので、
-- クライアント側の型が変わっても D1 の移行は要らない。
-- 削除は行を消さず data = NULL の墓標にする（別の端末に「消えた」ことを伝えるため）。
-- seq はユーザーごとに単調増加するカーソル。クライアントは「seq > 前回のカーソル」の行だけを受け取る。
CREATE TABLE IF NOT EXISTS records (
  user_id    TEXT    NOT NULL,   -- Access の email
  tbl        TEXT    NOT NULL,   -- 'products' | 'purchases' | 'reviews' | 'categories'
  key        TEXT    NOT NULL,   -- jan または id
  data       TEXT,               -- JSON。NULL は削除済み（墓標）
  updated_at INTEGER NOT NULL,   -- クライアント側の変更時刻（epoch ms）。新しい方が勝つ
  seq        INTEGER NOT NULL,
  PRIMARY KEY (user_id, tbl, key)
);
CREATE INDEX IF NOT EXISTS records_user_seq ON records (user_id, seq);
