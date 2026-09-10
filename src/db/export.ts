import { formatDate } from '../lib/format'
import { db } from './db'
import { silently, type SyncTable } from './outbox'
import type { Category, Product, Purchase, Review } from './types'
import { sanitizeRow } from './validate'

// 数年かけて貯める前提のデータなので、JSON / CSV への完全エクスポートを最初のリリースに含める（§6.4）。
// 後付けにすると構造が複雑化して塩漬けになる。

export const EXPORT_VERSION = 1

export type Backup = {
  app: 'matakore'
  version: number
  exportedAt: number
  products: Product[]
  purchases: Purchase[]
  reviews: Review[]
  categories: Category[]
}

export const buildBackup = async (): Promise<Backup> => {
  const [products, purchases, reviews, categories] = await Promise.all([
    db.products.toArray(),
    db.purchases.toArray(),
    db.reviews.toArray(),
    db.categories.toArray(),
  ])
  return { app: 'matakore', version: EXPORT_VERSION, exportedAt: Date.now(), products, purchases, reviews, categories }
}

const csvCell = (v: unknown) => {
  const s = v === undefined || v === null ? '' : String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

const toCsv = (rows: unknown[][]) => `﻿${rows.map((r) => r.map(csvCell).join(',')).join('\r\n')}\r\n`

/** 評価CSV。商品名を join して人間が読める形にする（評価だけでは後から見て分からないため）。 */
export const buildReviewsCsv = async () => {
  const [reviews, products, purchases, categories] = await Promise.all([
    db.reviews.toArray(),
    db.products.toArray(),
    db.purchases.toArray(),
    db.categories.toArray(),
  ])
  const productBy = new Map(products.map((p) => [p.jan, p]))
  const categoryBy = new Map(categories.map((c) => [c.id, c]))
  const counts = new Map<string, { count: number; last: number }>()
  for (const p of purchases) {
    const c = counts.get(p.jan) ?? { count: 0, last: 0 }
    counts.set(p.jan, { count: c.count + 1, last: Math.max(c.last, p.purchasedAt) })
  }
  const rows: unknown[][] = [
    ['jan', 'name', 'brand', 'major', 'minor', 'intent', 'memo', 'tags', 'stars', 'updatedAt', 'purchaseCount', 'lastPurchasedAt'],
  ]
  for (const r of reviews.sort((a, b) => b.updatedAt - a.updatedAt)) {
    const p = productBy.get(r.jan)
    const c = p ? categoryBy.get(p.categoryId) : undefined
    const stat = counts.get(r.jan)
    rows.push([
      r.jan,
      p?.name ?? '',
      p?.brand ?? '',
      c?.major ?? '',
      c?.minor ?? '',
      r.intent,
      r.memo ?? '',
      r.tags.join(' '),
      r.stars ?? '',
      formatDate(r.updatedAt),
      stat?.count ?? 0,
      stat?.last ? formatDate(stat.last) : '',
    ])
  }
  return toCsv(rows)
}

export const buildPurchasesCsv = async () => {
  const [purchases, products] = await Promise.all([db.purchases.toArray(), db.products.toArray()])
  const productBy = new Map(products.map((p) => [p.jan, p]))
  const rows: unknown[][] = [['id', 'jan', 'name', 'purchasedAt', 'price', 'store']]
  for (const p of purchases.sort((a, b) => b.purchasedAt - a.purchasedAt)) {
    rows.push([p.id, p.jan, productBy.get(p.jan)?.name ?? '', formatDate(p.purchasedAt), p.price ?? '', p.store ?? ''])
  }
  return toCsv(rows)
}

export const download = (filename: string, content: string, mime: string) => {
  const url = URL.createObjectURL(new Blob([content], { type: `${mime};charset=utf-8` }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.append(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export type ImportResult = { products: number; purchases: number; reviews: number; categories: number }

/** 形の通る行だけを残す（同期の受信と同じ検証）。壊れた行は黙って落とし、件数に含めない */
const rowsOf = <T,>(tbl: SyncTable, v: unknown): T[] =>
  (Array.isArray(v) ? v : []).map((r) => sanitizeRow(tbl, r)).filter((r): r is Record<string, unknown> => r !== null) as T[]

/** 完全バックアップの取り込み。同じキーは上書きするマージ。 */
export const importBackup = async (json: string): Promise<ImportResult> => {
  const parsed: unknown = JSON.parse(json)
  if (!parsed || typeof parsed !== 'object') throw new Error('JSON の形式が不正です')
  const data = parsed as Partial<Backup>
  if (data.app && data.app !== 'matakore') throw new Error('matakore のバックアップではありません')

  const products = rowsOf<Product>('products', data.products)
  const purchases = rowsOf<Purchase>('purchases', data.purchases)
  const reviews = rowsOf<Review>('reviews', data.reviews)
  const categories = rowsOf<Category>('categories', data.categories)

  await db.transaction('rw', db.products, db.purchases, db.reviews, db.categories, async () => {
    if (categories.length) await db.categories.bulkPut(categories)
    if (products.length) await db.products.bulkPut(products)
    if (purchases.length) await db.purchases.bulkPut(purchases)
    if (reviews.length) await db.reviews.bulkPut(reviews)
  })

  return {
    products: products.length,
    purchases: purchases.length,
    reviews: reviews.length,
    categories: categories.length,
  }
}

/**
 * この端末のデータを全部消す。サーバーの控えには触らない（同期に載せない）ので、
 * 次の同期で控えがそのまま戻ってくる。控えごと消したいときは先に lib/sync.ts の wipeRemote を呼ぶ。
 * 同期の状態も消すので、次回は初回接続としてサーバーから全部受け取り直す。
 */
export const wipeAll = async () => {
  await db.transaction('rw', [db.products, db.purchases, db.reviews, db.categories, db.outbox, db.meta], async (tx) => {
    silently(tx)
    await Promise.all([
      db.products.clear(),
      db.purchases.clear(),
      db.reviews.clear(),
      db.categories.clear(),
      db.outbox.clear(),
      db.meta.clear(),
    ])
  })
}
