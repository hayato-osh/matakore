import { expect, test } from 'vitest'
import { suggestCategory } from '../classify'

test.each([
  ['ハウス こくまろカレー 中辛 140g', '食品/カレー・ハヤシ'],
  ['日清 カップヌードル シーフード', '食品/カップ麺'],
  ['サッポロ一番 みそラーメン 5食', '食品/袋麺'],
  ['味の素 ギョーザ 12個', '食品/冷凍餃子'],
  ['永谷園 お茶づけ海苔', '食品/ふりかけ・ごはんのお供'],
  ['伊藤園 おーいお茶 緑茶 600ml', '飲料/お茶'],
  ['ボス アイスコーヒー 無糖', '飲料/コーヒー'],
  ['明治 ブルガリアヨーグルト', '食品/ヨーグルト'],
  ['カルビー ポテトチップス うすしお', '菓子/スナック'],
  ['花王 アタック 抗菌EX 詰め替え', '日用品/洗剤・柔軟剤'],
  ['キッコーマン しょうゆ 1L', '食品/調味料'],
])('%s → %s', (name, expected) => {
  expect(suggestCategory(name)).toBe(expected)
})

test('全角・半角の揺れを吸収する', () => {
  expect(suggestCategory('ｶﾚｰ 中辛')).toBe('食品/カレー・ハヤシ')
})

test('メーカー名も手掛かりにする', () => {
  expect(suggestCategory('ブルガリア', '明治')).toBe('食品/ヨーグルト')
})

test('手掛かりが無ければ何も提案しない', () => {
  expect(suggestCategory('謎の商品')).toBeUndefined()
  expect(suggestCategory('')).toBeUndefined()
})
