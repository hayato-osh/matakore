// EC API は「商品」ではなく「出品」を返す（§4.2）。
// 『【送料無料】ハウス こくまろカレー 中辛 140g×5個 まとめ買い』のようなノイズ入りタイトルが来る前提で組む。
// Phase 0 では手入力／貼り付けにしか効かないが、Phase 1 で API 由来の名前をそのまま通せるようにここに置く。
// 生データは必ず rawName に残すので、ここは多少踏み込んで削ってよい。

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
]

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
    .replace(/\s*[×xX*]\s*\d+\s*(個|本|袋|箱|パック|缶|セット|入り?|p|P)?/g, ' ')
    // 「5個セット」「12本入り」
    .replace(/\s*\d+\s*(個|本|袋|箱|パック|缶)\s*(セット|入り?)/g, ' ')
    .replace(/\s*(1|１)\s*(ケース|箱)\s*/g, ' ')

export const normalizeProductName = (raw: string) => {
  let s = raw.normalize('NFKC')
  s = stripPromoBrackets(s)
  const promoRe = new RegExp(PROMO_WORDS.map(escapeForClass).join('|'), 'g')
  s = s.replace(promoRe, ' ')
  s = stripQuantitySuffix(s)
  s = s
    .replace(/[!！]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s/／|｜,、・-]+|[\s/／|｜,、・-]+$/g, '')
    .trim()
  // 削りすぎたら生データを返す。名前が消えるより多少汚い方がまし。
  return s.length >= 2 ? s : raw.trim()
}
