import type { SyncChange, SyncTable } from './types'

// ユーザーの全記録の控え（Phase 2）。products テーブル（共有マスタ）とは別物で、
// こちらはユーザーごと・JSON のまま・墓標つき。

export type RecordRow = {
  tbl: SyncTable
  key: string
  /** JSON。null は墓標 */
  data: string | null
  updated_at: number
  seq: number
}

/** 記録の控え。テストでは in-memory 実装に差し替える。 */
export type RecordStore = {
  /**
   * 新しい方が勝つ upsert（同時刻は入ってきた方）。負けた変更は捨てる。
   * 適用した行だけ seq が進む。seq はユーザー内で単調増加。
   */
  upsert(user: string, changes: SyncChange[]): Promise<void>
  /** seq > cursor の行を seq 順に最大 limit 件 */
  since(user: string, cursor: number, limit: number): Promise<RecordRow[]>
  /** 墓標を含む全行 */
  all(user: string): Promise<RecordRow[]>
}

// seq は「今のユーザーの最大 + 1」。batch は1トランザクションで順に走るので、同じ batch 内でも重ならない。
// ON CONFLICT の WHERE で古い変更を弾く（records.updated_at は既存行、excluded は入ってくる行）。
const UPSERT = `
  INSERT INTO records (user_id, tbl, key, data, updated_at, seq)
  VALUES (?1, ?2, ?3, ?4, ?5, (SELECT COALESCE(MAX(seq), 0) + 1 FROM records WHERE user_id = ?1))
  ON CONFLICT(user_id, tbl, key) DO UPDATE SET
    data = excluded.data, updated_at = excluded.updated_at, seq = excluded.seq
  WHERE excluded.updated_at >= records.updated_at`

/** D1 の batch に一度に載せる文の数。SQL サイズと bound パラメータの上限に余裕を残す */
const BATCH = 50

export const d1Records = (db: D1Database): RecordStore => ({
  async upsert(user, changes) {
    for (let i = 0; i < changes.length; i += BATCH) {
      await db.batch(
        changes
          .slice(i, i + BATCH)
          .map((c) =>
            db.prepare(UPSERT).bind(user, c.tbl, c.key, c.data === null ? null : JSON.stringify(c.data), c.at),
          ),
      )
    }
  },
  async since(user, cursor, limit) {
    const { results } = await db
      .prepare('SELECT tbl, key, data, updated_at, seq FROM records WHERE user_id = ?1 AND seq > ?2 ORDER BY seq LIMIT ?3')
      .bind(user, cursor, limit)
      .all<RecordRow>()
    return results
  },
  async all(user) {
    const { results } = await db
      .prepare('SELECT tbl, key, data, updated_at, seq FROM records WHERE user_id = ?1 ORDER BY seq')
      .bind(user)
      .all<RecordRow>()
    return results
  },
})
