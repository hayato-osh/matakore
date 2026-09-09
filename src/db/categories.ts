import type { Category, MajorCategory } from './types'

// 2階層固定（大分類・中分類）。3階層以上にすると入力時に迷って摩擦になる（§5.1）。
// 外部APIのジャンルは使わず自前で持つ。初期シードは50件程度、必要に応じてアプリから追加する。
const SEED: Record<MajorCategory, string[]> = {
  食品: [
    'カレー・ハヤシ',
    'パスタソース',
    'カップ麺',
    '袋麺',
    '冷凍餃子',
    '冷凍食品',
    'レトルト惣菜',
    '缶詰',
    '調味料',
    'ドレッシング',
    '味噌・だし',
    'つゆ・鍋つゆ',
    '米・パン',
    'ハム・ソーセージ',
    'チーズ',
    '豆腐・納豆',
    'ヨーグルト',
    '卵・乳製品',
    '惣菜・弁当',
    'ふりかけ・ごはんのお供',
    'スープ',
    'シリアル',
    '漬物',
    '中華・エスニック',
  ],
  飲料: [
    'コーヒー',
    'お茶',
    '水・炭酸水',
    'ジュース',
    '乳飲料',
    'スポーツドリンク',
    'エナジードリンク',
    'ビール・発泡酒',
    'チューハイ',
    'ワイン・日本酒',
  ],
  菓子: [
    'チョコレート',
    'スナック',
    'せんべい・米菓',
    'クッキー・ビスケット',
    'グミ・キャンディ',
    'アイス',
    '和菓子',
    'ナッツ・珍味',
    'プリン・デザート',
  ],
  日用品: [
    '洗剤・柔軟剤',
    'シャンプー・ボディソープ',
    'オーラルケア',
    '掃除用品',
    '紙製品',
    'ラップ・保存袋',
    'ゴミ袋',
    '虫よけ・防虫',
    'スキンケア',
    'その他日用品',
  ],
}

export const MAJORS: MajorCategory[] = ['食品', '飲料', '菓子', '日用品']

export const categoryId = (major: MajorCategory, minor: string) => `${major}/${minor}`

export const UNCATEGORIZED_ID = categoryId('食品', 'その他')

export const seedCategories = (): Category[] => {
  const list = MAJORS.flatMap((major) =>
    SEED[major].map((minor) => ({ id: categoryId(major, minor), major, minor })),
  )
  // どの大分類にも「その他」を用意する。分類に迷って入力が止まるのが最悪なので逃げ道を必ず置く。
  return [...list, ...MAJORS.map((major) => ({ id: categoryId(major, 'その他'), major, minor: 'その他' }))]
}

export const formatCategory = (c: Category | undefined) => (c ? `${c.major} / ${c.minor}` : '未分類')
