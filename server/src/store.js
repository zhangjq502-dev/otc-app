// Domain state used by the PostgreSQL repository and local development.
import Decimal from 'decimal.js'
import { EventEmitter } from 'node:events'
import { randomUUID, scryptSync, randomBytes, timingSafeEqual } from 'node:crypto'
import { config } from './config.js'

export class AppError extends Error {
  constructor(code, message, status = 400) {
    super(message)
    this.code = code
    this.status = status
  }
}

// ---------- 用户 ----------
function hashPassword(password, salt = randomBytes(16).toString('hex')) {
  return `${salt}:${scryptSync(password, salt, 32).toString('hex')}`
}

function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(':')
  const a = Buffer.from(hash, 'hex')
  const b = scryptSync(password, salt, 32)
  return a.length === b.length && timingSafeEqual(a, b)
}

const PAY_METHODS = {
  bank: '银行卡',
  alipay: '支付宝',
  wechat: '微信支付'
}

const MERCHANTS = [
  { name: '币安快付', orders: 18234, rate: 99.2 },
  { name: '诚信OTC', orders: 9871, rate: 98.7 },
  { name: '极速承兑', orders: 5420, rate: 97.9 },
  { name: '老王数字', orders: 3302, rate: 99.6 },
  { name: 'CryptoPal', orders: 2210, rate: 96.4 },
  { name: '安心商行', orders: 1288, rate: 98.1 }
]

// 法币参考价（CNY）
const FIAT_PRICE = { USDT: 7.18, BTC: 483000, ETH: 24800 }
export const OTC_COINS = Object.keys(FIAT_PRICE)

export const ORDER_STATUS = {
  PENDING: 'pending', // 待付款（买单：等我付款；卖单：等对方付款）
  PAID: 'paid', // 已付款，待放币
  COMPLETED: 'completed',
  CANCELLED: 'cancelled'
}

const coinDigits = (coin) => (coin === 'USDT' ? 2 : 6)
const round = (n, d) => new Decimal(n).toDecimalPlaces(d, Decimal.ROUND_HALF_UP).toNumber()

export class Store extends EventEmitter {
  constructor({ seed = true } = {}) {
    super()
    this.users = new Map()
    this.ads = []
    this.orders = new Map()
    this.timers = new Map()
    this.events = []
    if (seed) this.seed()
  }

  seed() {
    this.ensureAdmin()

    // 演示账号用固定 id：后端重启后旧 token 依然有效，演示时不用反复登录
    if (config.seedDemo) this.createUser('demo', '123456', 'demo-0000-0000-0001')
    let id = 1
    for (const coin of OTC_COINS) {
      MERCHANTS.forEach((m, i) => {
        for (const side of ['buy', 'sell']) {
          // side 以用户视角：buy = 用户向商家买币，商家报价略高于参考价
          const spread = (side === 'buy' ? 1 : -1) * (0.002 + i * 0.0015)
          const price = round(FIAT_PRICE[coin] * (1 + spread), 2)
          const available = coin === 'USDT' ? 5000 + i * 3721 : coin === 'BTC' ? 0.5 + i * 0.3 : 8 + i * 4
          const methods = Object.keys(PAY_METHODS).filter((_, k) => (i + k) % 3 !== 2 || k === 0)
          this.ads.push({
            id: String(id++),
            side,
            coin,
            fiat: 'CNY',
            price,
            available: round(available, coinDigits(coin)),
            minAmount: 100 + i * 100,
            maxAmount: 20000 + i * 10000,
            payMethods: methods,
            merchant: { ...m, online: i !== 4 }
          })
        }
      })
    }
  }

  // ---------- 用户 ----------
  ensureAdmin() {
    const existing = [...this.users.values()].find(u => u.username === 'admin')
    if (existing) {
      if (existing.role !== 'admin') throw new Error('Reserved admin username already exists; manual review required')
      return existing
    }
    const user = this.createUser('admin', process.env.ADMIN_PASSWORD || '123456', randomUUID(), true)
    user.role = 'admin'
    return user
  }

  adminUsers(actorId, { page = 1, search = '' } = {}) {
    if (this.getUser(actorId).role !== 'admin') throw new AppError(403, '需要管理员权限', 403)
    page = Math.max(1, Math.floor(Number(page) || 1))
    const users = [...this.users.values()].filter(u => u.username.includes(String(search).slice(0,64))).sort((a,b) => b.createdAt-a.createdAt)
    return { total: users.length, page, pageSize: 20, users: users.slice((page-1)*20,page*20).map(u=>this.publicUser(u)) }
  }

  adminCredit(actorId, { username, coin, amount }) {
    if (this.getUser(actorId).role !== 'admin') throw new AppError(403, '需要管理员权限', 403)
    if (!OTC_COINS.includes(coin)) throw new AppError(400, '币种不支持')
    const value = Number(amount)
    if (!Number.isFinite(value) || value <= 0 || value > 1000000 || !new Decimal(value).eq(new Decimal(value).toDecimalPlaces(coinDigits(coin)))) throw new AppError(400, '数量必须大于零、不超过100万且符合币种精度')
    const user = [...this.users.values()].find(u => u.username === username)
    if (!user) throw new AppError(404, '用户不存在', 404)
    const balance = user.assets[coin]
    balance.available = round(new Decimal(balance.available).plus(value), coinDigits(coin))
    return { user: this.publicUser(user), coin, amount: value }
  }

  createUser(username, password, id = randomUUID(), internal = false) {
    if (String(username).toLowerCase() === 'admin' && !internal) throw new AppError(1003, '该用户名不可注册')
    if (!/^[a-zA-Z0-9_]{3,16}$/.test(username)) {
      throw new AppError(1001, '用户名需为 3-16 位字母、数字或下划线')
    }
    if (typeof password !== 'string' || password.length < 6 || password.length > 128) {
      throw new AppError(1002, '密码需为 6-128 位')
    }
    if ([...this.users.values()].some((u) => u.username === username)) {
      throw new AppError(1003, '用户名已存在')
    }
    const user = {
      id,
      username,
      password: hashPassword(password),
      nickname: username,
      wallet: null,
      createdAt: Date.now(),
      // 资产：available 可用，frozen 冻结（卖单挂起中）
      assets: {
        USDT: { available: config.initialAssets ? 1000 : 0, frozen: 0 },
        BTC: { available: config.initialAssets ? 0.05 : 0, frozen: 0 },
        ETH: { available: config.initialAssets ? 1.2 : 0, frozen: 0 }
      }
    }
    this.users.set(user.id, user)
    return user
  }

  login(username, password) {
    const user = [...this.users.values()].find((u) => u.username === username)
    if (!user || !verifyPassword(String(password ?? ''), user.password)) {
      throw new AppError(1004, '用户名或密码错误', 401)
    }
    return user
  }

  getUser(id) {
    const user = this.users.get(id)
    if (!user) throw new AppError(401, '用户不存在', 401)
    return user
  }

  publicUser(user) {
    const { password, ...rest } = user
    return rest
  }

  bindWallet(userId, address) {
    const user = this.getUser(userId)
    user.wallet = { address, boundAt: Date.now() }
    return user
  }

  // ---------- 广告 ----------
  listAds({ side = 'buy', coin = 'USDT', payMethod } = {}) {
    return this.ads
      .filter((a) => a.side === side && a.coin === coin)
      .filter((a) => !payMethod || a.payMethods.includes(payMethod))
      .sort((a, b) => (side === 'buy' ? a.price - b.price : b.price - a.price))
  }

  getAd(id) {
    const ad = this.ads.find((a) => a.id === id)
    if (!ad) throw new AppError(2001, '广告不存在', 404)
    return ad
  }

  // ---------- 订单 ----------
  createOrder(userId, { adId, fiatAmount, payMethod }) {
    const user = this.getUser(userId)
    const ad = this.getAd(String(adId))
    const total = Number(fiatAmount)
    if (!Number.isFinite(total) || total <= 0) throw new AppError(2002, '请输入正确的金额')
    if (total < ad.minAmount || total > ad.maxAmount) {
      throw new AppError(2003, `单笔限额 ${ad.minAmount} - ${ad.maxAmount} CNY`)
    }
    if (!ad.payMethods.includes(payMethod)) throw new AppError(2004, '商家不支持该支付方式')
    // 实付金额以用户输入为准；币数量向下取整，避免平台多给币
    const fiatTotal = round(total, 2)
    const factor = 10 ** coinDigits(ad.coin)
    const amount = new Decimal(fiatTotal).div(ad.price).mul(factor).floor().div(factor).toNumber()
    if (amount <= 0) throw new AppError(2002, '金额不足以购买最小交易数量')
    if (amount > ad.available) throw new AppError(2005, '商家可交易数量不足')
    const hasActive = [...this.orders.values()].some(
      (o) => o.userId === userId && o.status === ORDER_STATUS.PENDING && o.side === ad.side
    )
    if (hasActive) throw new AppError(2006, '你有未完成的同类订单，请先处理')

    if (ad.side === 'sell') {
      const asset = user.assets[ad.coin] ?? (user.assets[ad.coin] = { available: 0, frozen: 0 })
      if (asset.available < amount) throw new AppError(2007, `${ad.coin} 可用余额不足`)
      asset.available = round(new Decimal(asset.available).minus(amount), coinDigits(ad.coin))
      asset.frozen = round(new Decimal(asset.frozen).plus(amount), coinDigits(ad.coin))
    }
    ad.available = round(new Decimal(ad.available).minus(amount), coinDigits(ad.coin))

    const now = Date.now()
    const order = {
      id: randomUUID(),
      userId,
      adId: ad.id,
      side: ad.side,
      coin: ad.coin,
      fiat: ad.fiat,
      price: ad.price,
      amount,
      total: fiatTotal,
      payMethod,
      payMethodName: PAY_METHODS[payMethod],
      merchant: { name: ad.merchant.name },
      // 买单时展示商家收款信息；卖单时展示自己的收款信息（演示数据）
      payee:
        ad.side === 'buy'
          ? { name: `${ad.merchant.name}（张*）`, account: payMethod === 'bank' ? '6222 **** **** 8842' : 'merchant@example.com' }
          : { name: user.nickname, account: '我的收款账户（演示）' },
      status: ORDER_STATUS.PENDING,
      createdAt: now,
      expireAt: now + config.orderPayTimeout,
      paidAt: null,
      completedAt: null,
      cancelReason: null
    }
    this.orders.set(order.id, order)
    this.schedule(order.id, 'expire', config.orderPayTimeout, () =>
      this.cancelOrder(order.id, null, '超时未付款，系统自动取消')
    )
    if (config.simulateMerchant && order.side === 'sell') {
      // 模拟商家（买家）付款
      this.schedule(order.id, 'merchantPay', config.merchantPayDelay, () => this.markPaid(order.id, null))
    }
    this.emitOrder(order)
    return order
  }

  listOrders(userId, status) {
    return [...this.orders.values()]
      .filter((o) => o.userId === userId && (!status || o.status === status))
      .sort((a, b) => b.createdAt - a.createdAt)
  }

  getOrder(userId, id) {
    const order = this.orders.get(String(id))
    if (!order || (userId && order.userId !== userId)) throw new AppError(3001, '订单不存在', 404)
    return order
  }

  // userId 为 null 表示系统/商家操作
  markPaid(id, userId) {
    const order = this.getOrder(userId, id)
    if (order.status === ORDER_STATUS.PENDING && order.expireAt <= Date.now()) throw new AppError(3008, '订单已超时')
    if (order.status !== ORDER_STATUS.PENDING) throw new AppError(3002, '订单状态已变化，请刷新')
    if (userId && order.side !== 'buy') throw new AppError(3003, '卖单需等待对方付款')
    order.status = ORDER_STATUS.PAID
    order.paidAt = Date.now()
    this.clear(order.id, 'expire')
    if (config.simulateMerchant && order.side === 'buy') {
      // 模拟商家确认收款后放币
      this.schedule(order.id, 'release', config.merchantReleaseDelay, () => this.complete(order.id, null))
    }
    this.emitOrder(order)
    return order
  }

  // 卖单：用户确认收到款后放币
  release(id, userId) {
    const order = this.getOrder(userId, id)
    if (order.side !== 'sell') throw new AppError(3004, '只有卖单需要你放币')
    if (order.status !== ORDER_STATUS.PAID) throw new AppError(3005, '对方尚未付款，不能放币')
    return this.complete(order.id, userId)
  }

  complete(id, userId) {
    const order = this.getOrder(userId, id)
    if (order.status !== ORDER_STATUS.PAID) throw new AppError(3002, '订单状态已变化，请刷新')
    const user = this.getUser(order.userId)
    const d = coinDigits(order.coin)
    const asset = user.assets[order.coin] ?? (user.assets[order.coin] = { available: 0, frozen: 0 })
    if (order.side === 'buy') {
      asset.available = round(new Decimal(asset.available).plus(order.amount), d)
    } else {
      asset.frozen = round(new Decimal(asset.frozen).minus(order.amount), d)
    }
    order.status = ORDER_STATUS.COMPLETED
    order.completedAt = Date.now()
    this.clearAll(order.id)
    this.emitOrder(order)
    return order
  }

  cancelOrder(id, userId, reason = '用户取消') {
    const order = this.getOrder(userId, id)
    if (order.status !== ORDER_STATUS.PENDING) throw new AppError(3006, '当前状态不能取消')
    if (userId && order.side === 'sell') throw new AppError(3007, '卖单请等待对方处理或超时自动取消')
    const ad = this.getAd(order.adId)
    const d = coinDigits(order.coin)
    ad.available = round(new Decimal(ad.available).plus(order.amount), d)
    if (order.side === 'sell') {
      const asset = this.getUser(order.userId).assets[order.coin]
      asset.frozen = round(new Decimal(asset.frozen).minus(order.amount), d)
      asset.available = round(new Decimal(asset.available).plus(order.amount), d)
    }
    order.status = ORDER_STATUS.CANCELLED
    order.cancelReason = reason
    this.clearAll(order.id)
    this.emitOrder(order)
    return order
  }

  emitOrder(order) {
    this.emit('order', order)
  }

  schedule(orderId, key, delay, fn) {
    const timer = setTimeout(() => {
      this.timers.get(orderId)?.delete(key)
      try {
        fn()
      } catch {
        // 订单状态已被用户操作改变，忽略
      }
    }, delay)
    if (!this.timers.has(orderId)) this.timers.set(orderId, new Map())
    this.timers.get(orderId).set(key, timer)
  }

  clear(orderId, key) {
    const t = this.timers.get(orderId)?.get(key)
    if (t) clearTimeout(t)
    this.timers.get(orderId)?.delete(key)
  }

  clearAll(orderId) {
    for (const t of this.timers.get(orderId)?.values() ?? []) clearTimeout(t)
    this.timers.delete(orderId)
  }

  shutdown() {
    for (const id of this.timers.keys()) this.clearAll(id)
  }

  // ---------- 埋点 ----------
  addEvents(events, meta) {
    const list = (Array.isArray(events) ? events : []).slice(0, 100).map((e) => ({
      ...e,
      ...meta,
      receivedAt: Date.now()
    }))
    this.events.push(...list)
    if (this.events.length > 5000) this.events.splice(0, this.events.length - 5000)
    return list.length
  }

  trackStats() {
    const byType = {}
    const pageViews = {}
    const apiCost = {}
    for (const e of this.events) {
      byType[e.type] = (byType[e.type] || 0) + 1
      if (e.type === 'page_view') pageViews[e.page] = (pageViews[e.page] || 0) + 1
      if (e.type === 'api' && typeof e.duration === 'number') {
        const s = (apiCost[e.url] ??= { count: 0, total: 0, max: 0, errors: 0 })
        s.count++
        s.total += e.duration
        s.max = Math.max(s.max, e.duration)
        if (!e.ok) s.errors++
      }
    }
    const api = Object.fromEntries(
      Object.entries(apiCost).map(([url, s]) => [url, { count: s.count, avg: Math.round(s.total / s.count), max: s.max, errors: s.errors }])
    )
    return {
      total: this.events.length,
      byType,
      pageViews,
      api,
      recentErrors: this.events.filter((e) => e.type === 'error').slice(-10)
    }
  }
}

export { PAY_METHODS }
