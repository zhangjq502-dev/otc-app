// 数字与时间格式化

// 价格：>= 1 保留 2 位并加千分位；< 1 按币种精度保留
export function formatPrice(price: number, digits?: number): string {
  if (!Number.isFinite(price)) return '--'
  const d = digits ?? (price >= 1 ? 2 : 4)
  return price.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })
}

export function formatPercent(change: number): string {
  if (!Number.isFinite(change)) return '--'
  return `${change >= 0 ? '+' : ''}${change.toFixed(2)}%`
}

// 大数字缩写：成交额等
export function formatCompact(n: number): string {
  if (n >= 1e8) return `${(n / 1e8).toFixed(2)}亿`
  if (n >= 1e4) return `${(n / 1e4).toFixed(2)}万`
  return n.toFixed(2)
}

export function formatAmount(n: number, coin: string): string {
  return n.toFixed(coin === 'USDT' ? 2 : 6)
}

const pad = (n: number) => String(n).padStart(2, '0')

export function formatTime(ts: number, withDate = true): string {
  const d = new Date(ts)
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  return withDate ? `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${time}` : time
}

// 倒计时：毫秒 → mm:ss
export function formatCountdown(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  return `${pad(Math.floor(s / 60))}:${pad(s % 60)}`
}

export function shortAddress(addr: string): string {
  return addr ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : ''
}
