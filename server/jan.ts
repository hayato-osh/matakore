// PWA 側 src/lib/jan.ts と同じ判定。Worker は不正な JAN で外部APIを叩かない。

const checkDigitOk = (digits: string) => {
  let sum = 0
  for (let i = 0; i < digits.length - 1; i++) {
    const n = digits.charCodeAt(i) - 48
    const fromRight = digits.length - 1 - i
    sum += fromRight % 2 === 1 ? n * 3 : n
  }
  return (10 - (sum % 10)) % 10 === digits.charCodeAt(digits.length - 1) - 48
}

export const isValidJan = (s: string) => /^(\d{8}|\d{13})$/.test(s) && checkDigitOk(s)
