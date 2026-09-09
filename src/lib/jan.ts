/** JAN（EAN-13 / EAN-8）。国内食品はほぼこれで足りる（§4.1）。 */

const checkDigitOf = (body: string) => {
  let sum = 0
  const rev = [...body].reverse()
  rev.forEach((d, i) => {
    sum += Number(d) * (i % 2 === 0 ? 3 : 1)
  })
  return (10 - (sum % 10)) % 10
}

/** UPC-A(12桁) は先頭に 0 を足して EAN-13 に寄せる。ネイティブ検出器が upc_a を返すことがあるため。 */
export const normalizeJan = (code: string) => {
  const digits = code.replace(/\D/g, '')
  return digits.length === 12 ? `0${digits}` : digits
}

export const isValidJan = (code: string) => {
  if (!/^(\d{8}|\d{13})$/.test(code)) return false
  return checkDigitOf(code.slice(0, -1)) === Number(code.slice(-1))
}

/** 表示用。4901234-567894 のように区切る。 */
export const formatJan = (jan: string) =>
  jan.length === 13 ? `${jan.slice(0, 1)} ${jan.slice(1, 7)} ${jan.slice(7, 12)} ${jan.slice(12)}` : jan
