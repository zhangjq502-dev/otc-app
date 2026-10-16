// 模拟行情引擎：随机游走生成价格，维护 1 分钟 K 线，供 REST 与 WebSocket 使用
import { EventEmitter } from 'node:events'

// dailyTurnover：24h 成交额量级（USDT），用来推算每分钟成交量
const SEEDS = [
  { symbol: 'BTC', price: 67234.5, volatility: 0.0006, dailyTurnover: 2.8e10 },
  { symbol: 'ETH', price: 3456.12, volatility: 0.0008, dailyTurnover: 1.2e10 },
  { symbol: 'SOL', price: 152.37, volatility: 0.0012, dailyTurnover: 2.5e9 },
  { symbol: 'BNB', price: 589.4, volatility: 0.0007, dailyTurnover: 1.1e9 },
  { symbol: 'XRP', price: 0.5234, volatility: 0.001, dailyTurnover: 9e8 },
  { symbol: 'DOGE', price: 0.1234, volatility: 0.0015, dailyTurnover: 6e8 }
]

export const QUOTE = 'USDT'
export const INTERVALS = { '1m': 1, '5m': 5, '15m': 15, '1h': 60, '4h': 240 }

const MINUTE = 60 * 1000
// 预生成的 1 分钟 K 线数量：足够聚合出 200 根 4h K 线
const HISTORY_MINUTES = 240 * 200

const round = (n, digits) => Number(n.toFixed(digits))
const digitsOf = (price) => (price >= 1 ? 2 : 6)

function step(price, volatility) {
  // 正态近似的随机扰动
  const r = (Math.random() + Math.random() + Math.random() - 1.5) / 1.5
  return Math.max(price * (1 + r * volatility * 3), price * 0.5)
}

function createCoin(seed, now) {
  const digits = digitsOf(seed.price)
  // 每分钟平均成交量（币本位）
  const minuteVolume = seed.dailyTurnover / 1440 / seed.price
  const candles = []
  // 从过去倒推生成历史，最后一根收盘价落在种子价格附近
  let price = seed.price
  const start = Math.floor(now / MINUTE) * MINUTE - (HISTORY_MINUTES - 1) * MINUTE
  const closes = []
  for (let i = 0; i < HISTORY_MINUTES; i++) {
    closes.push(price)
    price = step(price, seed.volatility * 0.5)
  }
  closes.reverse()
  let prevClose = closes[0]
  for (let i = 0; i < HISTORY_MINUTES; i++) {
    const open = prevClose
    const close = closes[i]
    const wiggle = Math.abs(close - open) + open * seed.volatility
    candles.push({
      time: start + i * MINUTE,
      open: round(open, digits),
      high: round(Math.max(open, close) + Math.random() * wiggle, digits),
      low: round(Math.min(open, close) - Math.random() * wiggle, digits),
      close: round(close, digits),
      volume: round(minuteVolume * (0.4 + Math.random() * 1.2), 4)
    })
    prevClose = close
  }
  return { symbol: seed.symbol, volatility: seed.volatility, digits, minuteVolume, candles }
}

export class MarketEngine extends EventEmitter {
  constructor() {
    super()
    const now = Date.now()
    this.coins = new Map(SEEDS.map((s) => [s.symbol, createCoin(s, now)]))
    this.timer = null
  }

  start(interval) {
    this.timer = setInterval(() => this.tick(), interval)
  }

  stop() {
    clearInterval(this.timer)
  }

  hasSymbol(symbol) {
    return this.coins.has(symbol)
  }

  tick(now = Date.now()) {
    for (const coin of this.coins.values()) {
      const last = coin.candles[coin.candles.length - 1]
      // 每秒一跳，幅度按分钟波动率 / √60 缩放，保持与历史 K 线一致的波动水平
      const price = round(step(last.close, coin.volatility * 0.07), coin.digits)
      const bucket = Math.floor(now / MINUTE) * MINUTE
      if (bucket > last.time) {
        coin.candles.push({ time: bucket, open: last.close, high: price, low: price, close: price, volume: 0 })
        if (coin.candles.length > HISTORY_MINUTES) coin.candles.shift()
      } else {
        last.close = price
        last.high = Math.max(last.high, price)
        last.low = Math.min(last.low, price)
      }
      // 每秒累加约 1/60 的分钟成交量
      const cur = coin.candles[coin.candles.length - 1]
      cur.volume = round(cur.volume + (coin.minuteVolume / 60) * Math.random() * 2, 4)
    }
    this.emit('tick', this.getTickers())
  }

  // 24 小时统计：最近 1440 根 1 分钟 K 线
  getTicker(symbol) {
    const coin = this.coins.get(symbol)
    if (!coin) return null
    const day = coin.candles.slice(-1440)
    const open = day[0].open
    const last = day[day.length - 1].close
    let high = -Infinity
    let low = Infinity
    let volume = 0
    for (const c of day) {
      high = Math.max(high, c.high)
      low = Math.min(low, c.low)
      volume += c.volume
    }
    return {
      symbol,
      quote: QUOTE,
      price: last,
      open,
      high,
      low,
      change: round(((last - open) / open) * 100, 2),
      volume: round(volume, 2),
      turnover: round(volume * last, 2),
      digits: coin.digits,
      time: day[day.length - 1].time
    }
  }

  getTickers() {
    return [...this.coins.keys()].map((s) => this.getTicker(s))
  }

  // 把 1 分钟 K 线聚合成指定周期
  getKlines(symbol, interval = '15m', limit = 120) {
    const coin = this.coins.get(symbol)
    const size = INTERVALS[interval]
    if (!coin || !size) return null
    const span = size * MINUTE
    const result = []
    for (const c of coin.candles) {
      const time = Math.floor(c.time / span) * span
      const cur = result[result.length - 1]
      if (cur && cur.time === time) {
        cur.high = Math.max(cur.high, c.high)
        cur.low = Math.min(cur.low, c.low)
        cur.close = c.close
        cur.volume = round(cur.volume + c.volume, 4)
      } else {
        result.push({ ...c, time })
      }
    }
    return result.slice(-Math.min(limit, 500))
  }
}
