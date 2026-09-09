// EC API は「商品」ではなく「出品」を返す（§4.2）。
// 『【送料無料】ハウス こくまろカレー 中辛 140g×5個 まとめ買い』のようなノイズ入りタイトルが来る前提で組む。
// Phase 0 では手入力／貼り付けにしか効かないが、Phase 1 で API 由来の名前をそのまま通せるようにここに置く。
// 生データは必ず rawName に残すので、ここは多少踏み込んで削ってよい。

import { findMaker, stripMakerTokens } from './maker'

const PROMO_WORDS = [
  '送料無料',
  '送料込み',
  '送料込',
  'まとめ買い',
  'まとめ売り',
  'ケース販売',
  'ケース売り',
  '箱売り',
  '業務用',
  '訳あり',
  'アウトレット',
  '在庫処分',
  '数量限定',
  '限定特価',
  '特価',
  '激安',
  '最安',
  'セール',
  'ポイント消化',
  'ポイント',
  'あす楽',
  '即納',
  '正規品',
  '新品',
  '国産',
  'メール便',
  'クーポン',
  // 出品者のタグ・煽り。商品の属性ではない
  'イチオシ',
  '公式',
  'お買い得',
  'おすすめ',
  'お得',
  '人気',
  'ランキング',
  '税込',
  '割引',
  '当日発送',
  '翌日配送',
  '即日',
  '在庫あり',
  'ケース買い',
  '箱買い',
  'セット買い',
  'セット販売',
  'ローリングストック',
  '備蓄',
  '防災',
]

// 飾り記号。◎○△✕ は判定の記号なので触らない（商品名にはまず出てこないが、出ても壊さない）
const DECORATION_RE = /[★☆◆◇■□●▲▼♪※＊*]/g

const BRACKET_PAIRS: [string, string][] = [
  ['【', '】'],
  ['［', '］'],
  ['\\[', '\\]'],
  ['〔', '〕'],
  ['《', '》'],
  ['（', '）'],
  ['\\(', '\\)'],
]

const escapeForClass = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const stripPromoBrackets = (s: string) => {
  let out = s
  for (const [open, close] of BRACKET_PAIRS) {
    const re = new RegExp(`${open}[^${open}${close}]*${close}`, 'g')
    out = out.replace(re, (m) => (PROMO_WORDS.some((w) => m.includes(w)) ? ' ' : m))
  }
  // 先頭の 【...】 は販売店の煽り枠であることが圧倒的に多いので落とす
  return out.replace(/^\s*【[^】]*】\s*/, '')
}

const stripQuantitySuffix = (s: string) =>
  s
    // 140g×5個 / ×12本 / x24 のような入数表記。
    // 単位が日本語なので \b は使えない（単語境界が立たず単位だけ残る）
    .replace(/\s*[×xX*]\s*\d+\s*(個|本|袋|箱|パック|缶|食|セット|入り?|p|P)?/g, ' ')
    // 「5個セット」「12個入り」「5食パック」「6本」。枚は「6枚切」のように商品の仕様なので触らない
    .replace(/\s*\d+\s*(個|本|袋|箱|パック|缶|食)\s*(セット|入り?|パック)?(?![a-zA-Z0-9ぁ-ん])/g, ' ')
    // 「1セット」「1ケース」「1箱」
    .replace(/\s*\d+\s*(ケース|セット|箱)\s*/g, ' ')


/** 入数を抜いた後に残る「( )」「( (140g) )」を畳む。1セット（1箱（140g）×3）のような入れ子で出る。 */
const collapseBrackets = (s: string) => {
  let out = s
  for (let i = 0; i < 3; i++) {
    const next = out
      // 空の括弧
      .replace(/[（([［]\s*[)）\]］]/g, ' ')
      // 括弧の中身が括弧だけ → 内側だけ残す
      .replace(/[（(]\s*([（(][^()（）]*[)）])\s*[)）]/g, '$1')
    if (next === out) break
    out = next
  }
  return out
}

/** 同じ語が2回出たら後ろを消す。「日清製粉ウェルナ 青の洞窟 … 日清製粉ウェルナ」のように出品者がメーカー名を前後に置く。 */
const dedupeTokens = (s: string) => {
  const seen = new Set<string>()
  return s
    .split(' ')
    .filter((t) => {
      if (t.length < 2) return true
      if (seen.has(t)) return false
      seen.add(t)
      return true
    })
    .join(' ')
}

// 商品名の両端に付く分類・機能語。「青の洞窟 … パスタソース レンジ対応」の末尾や「パスタソース 青の洞窟 …」の先頭。
// 途中にあるものは触らない（「ミートソース」「ドレッシング 和風」を壊さないため）。
const EDGE_WORDS = new Set(
  [
    'パスタソース', 'カップ麺', '袋麺', '即席麺', 'インスタント', '即席', 'レトルト', 'レトルト食品', 'レトルトカレー',
    '調味料', 'ドレッシング', '冷凍食品', '冷凍', '缶詰', '飲料', '清涼飲料水', '菓子', 'お菓子', 'スナック菓子',
    '食品', '日用品', '洗剤', 'パスタ', 'ソース', '惣菜', 'おかず',
    'レンジ対応', '電子レンジ対応', 'レンジ調理', '湯せん', '湯煎', '常温', '常温保存', '箱入', '個包装', '詰合せ', '詰め合わせ',
    '国内製造', '日本製', 'ケース', 'セット',
  ].map((w) => w.normalize('NFKC')),
)

// 内容量・人数。JAN で商品は一意に決まるので名前には要らない。
// 「120g・1人前」「180g(1人前)」「2L」「500ml」「5食」。「6枚切」のような仕様（枚・切）は残す。
const stripSizeSpec = (s: string) =>
  s
    .replace(/[・･]?\s*\d+(?:[.,]\d+)?\s*(?:g|kg|mg|ml|mL|l|L|ℓ|cc|人前|人分|食入り?|食|玉|粒|錠|包)(?![a-zA-Z0-9ぁ-ん])/g, ' ')
    .replace(/\s*[・･]\s*$/g, '')

const stripEdgeWords = (s: string) => {
  const tokens = s.split(' ')
  while (tokens.length > 1 && EDGE_WORDS.has(tokens[tokens.length - 1])) tokens.pop()
  while (tokens.length > 1 && EDGE_WORDS.has(tokens[0])) tokens.shift()
  return tokens.join(' ')
}

export const normalizeProductName = (raw: string) => {
  let s = raw.normalize('NFKC')
  s = stripPromoBrackets(s)
  const promoRe = new RegExp(PROMO_WORDS.map(escapeForClass).join('|'), 'g')
  s = s.replace(promoRe, ' ')
  s = stripQuantitySuffix(s)
  s = stripSizeSpec(s)
  s = collapseBrackets(s)
  s = s
    .replace(DECORATION_RE, ' ')
    .replace(/[!！]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s/／|｜,、・-]+|[\s/／|｜,、・-]+$/g, '')
    .trim()
  s = dedupeTokens(s)
  s = stripEdgeWords(s)
  // 削りすぎたら生データを返す。名前が消えるより多少汚い方がまし。
  return s.length >= 2 ? s : raw.trim()
}

/**
 * 出品タイトルを「商品名」と「メーカー」に分ける。
 * EC の brand 欄はシリーズ名（青の洞窟、無印良品）のことが多いので、タイトル中のメーカー名を辞書で拾って
 * メーカー欄に移し、商品名からは外す。辞書に無ければ brand 欄の値をそのまま使う。
 */
export const splitProduct = (raw: string, brandHint?: string): { name: string; brand?: string } => {
  const maker = findMaker(raw) ?? findMaker(brandHint)
  let name = normalizeProductName(raw)
  if (maker) name = stripEdgeWords(stripMakerTokens(name, maker).replace(/\s+/g, ' ').trim())
  return { name: name.length >= 2 ? name : normalizeProductName(raw), brand: maker ?? (brandHint?.trim() || undefined) }
}
