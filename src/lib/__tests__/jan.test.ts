import { expect, test } from 'vitest'
import { formatJan, isValidJan, normalizeJan } from '../jan'
import { normalizeProductName } from '../normalize'

test('チェックディジットが一致するものだけ通す', () => {
  expect(isValidJan('4902102072618')).toBe(true)
  expect(isValidJan('4902102072619')).toBe(false)
  expect(isValidJan('49123456')).toBe(true)
  expect(isValidJan('12345')).toBe(false)
  expect(isValidJan('490210207261a')).toBe(false)
})

test('UPC-A は EAN-13 に寄せる', () => {
  expect(normalizeJan('036000291452')).toBe('0036000291452')
  expect(isValidJan(normalizeJan('036000291452'))).toBe(true)
  expect(normalizeJan('4902102072618')).toBe('4902102072618')
})

test('表示用に区切る', () => {
  expect(formatJan('4902102072618')).toBe('4 902102 07261 8')
})

test('出品タイトルのノイズを落とす', () => {
  expect(normalizeProductName('【送料無料】ハウス こくまろカレー 中辛 140g×5個 まとめ買い')).toBe(
    'ハウス こくまろカレー 中辛',
  )
  expect(normalizeProductName('S&B ゴールデンカレー 中辛 198g 5個セット')).toBe('S&B ゴールデンカレー 中辛')
})

test('商品名の一部である括弧は残す', () => {
  expect(normalizeProductName('日清 カップヌードル (シーフード)')).toBe('日清 カップヌードル (シーフード)')
})

test('削りすぎたら元の文字列に戻す', () => {
  expect(normalizeProductName('送料無料')).toBe('送料無料')
})
