import type { RepeatIntent } from '../db/types'

// 主軸は repeat intent の4値（§3.3）。星5段階は採用しない。
// 店頭で必要な情報は「また買うか」の一点で、星3.5と星4の区別は判断に寄与しない。
export const INTENTS: {
  value: RepeatIntent
  mark: string
  label: string
  hint: string
}[] = [
  { value: 'staple', mark: '◎', label: '定番', hint: '切らしたら買う' },
  { value: 'yes', mark: '○', label: 'また買う', hint: '見かけたら買う' },
  { value: 'meh', mark: '△', label: '微妙', hint: 'あえて買わない' },
  { value: 'no', mark: '✕', label: 'もういい', hint: '二度と買わない' },
]

export const intentMeta = (intent: RepeatIntent) => INTENTS.find((i) => i.value === intent)!
