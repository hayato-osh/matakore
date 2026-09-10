export const formatDate = (ts: number) => {
  const d = new Date(ts)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

export const formatDateTime = (ts: number) => {
  const d = new Date(ts)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${formatDate(ts)} ${p(d.getHours())}:${p(d.getMinutes())}`
}

const DAY = 24 * 60 * 60 * 1000

export const relativeDays = (ts: number, now = Date.now()) => {
  const days = Math.floor((now - ts) / DAY)
  if (days <= 0) return '今日'
  if (days === 1) return '昨日'
  if (days < 30) return `${days}日前`
  if (days < 365) return `${Math.floor(days / 30)}か月前`
  return `${Math.floor(days / 365)}年前`
}

export const parseTags = (input: string) =>
  [...new Set(input.split(/[\s,、]+/).map((t) => t.replace(/^#/, '').trim()).filter(Boolean))]
