import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { Wallet } from 'ethers'
import { config } from '../src/config.js'
import { createApp } from '../src/app.js'
import { MarketEngine } from '../src/market.js'
import { Store } from '../src/store.js'

process.env.NODE_ENV = 'test'
// 测试里把商家模拟延迟调短
config.merchantReleaseDelay = 50
config.merchantPayDelay = 50

let server
let base
let store
let token

const api = async (method, path, body, auth = token) => {
  const res = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: `Bearer ${auth}` } : {}) },
    body: body ? JSON.stringify(body) : undefined
  })
  return { status: res.status, ...(await res.json()) }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

before(async () => {
  store = new Store()
  server = http.createServer(createApp({ store, market: new MarketEngine() }))
  await new Promise((r) => server.listen(0, r))
  base = `http://127.0.0.1:${server.address().port}`
})

after(() => {
  store.shutdown()
  server.close()
})

test('登录：错误密码返回 401，正确密码返回 token', async () => {
  const bad = await api('POST', '/api/auth/login', { username: 'demo', password: 'wrong' }, null)
  assert.equal(bad.status, 401)
  const res = await api('POST', '/api/auth/login', { username: 'demo', password: '123456' }, null)
  assert.equal(res.code, 0)
  assert.ok(res.data.token)
  assert.equal(res.data.user.password, undefined)
  token = res.data.token
})

test('未登录访问订单接口返回 401', async () => {
  const res = await api('GET', '/api/otc/orders', null, null)
  assert.equal(res.status, 401)
})

test('行情与 K 线', async () => {
  const tickers = await api('GET', '/api/market/tickers')
  assert.equal(tickers.data.length, 6)
  const klines = await api('GET', '/api/market/klines?symbol=BTC&interval=1h&limit=50')
  assert.equal(klines.data.length, 50)
  const k = klines.data[0]
  assert.ok(k.high >= Math.max(k.open, k.close) && k.low <= Math.min(k.open, k.close))
  const bad = await api('GET', '/api/market/klines?symbol=BTC&interval=3m')
  assert.equal(bad.status, 400)
})

test('买单流程：下单 → 标记付款 → 商家放币 → 资产增加', async () => {
  const before = (await api('GET', '/api/user/me')).data.assets.USDT.available
  const [ad] = (await api('GET', '/api/otc/ads?side=buy&coin=USDT')).data
  const tooSmall = await api('POST', '/api/otc/orders', { adId: ad.id, fiatAmount: 1, payMethod: 'bank' })
  assert.equal(tooSmall.code, 2003)

  const order = (await api('POST', '/api/otc/orders', { adId: ad.id, fiatAmount: 500, payMethod: 'bank' })).data
  assert.equal(order.status, 'pending')
  // 实付金额等于用户输入，数量向下取整
  assert.equal(order.total, 500)
  assert.ok(order.amount * order.price <= 500)
  const dup = await api('POST', '/api/otc/orders', { adId: ad.id, fiatAmount: 500, payMethod: 'bank' })
  assert.equal(dup.code, 2006)

  const paid = await api('POST', `/api/otc/orders/${order.id}/pay`)
  assert.equal(paid.data.status, 'paid')
  await sleep(120)
  const done = (await api('GET', `/api/otc/orders/${order.id}`)).data
  assert.equal(done.status, 'completed')
  const afterBal = (await api('GET', '/api/user/me')).data.assets.USDT.available
  assert.equal(Number((afterBal - before).toFixed(2)), order.amount)
})

test('卖单流程：冻结资产 → 对方付款 → 我放币 → 冻结扣除', async () => {
  const [ad] = (await api('GET', '/api/otc/ads?side=sell&coin=USDT')).data
  const order = (await api('POST', '/api/otc/orders', { adId: ad.id, fiatAmount: 500, payMethod: 'bank' })).data
  let me = (await api('GET', '/api/user/me')).data
  assert.equal(me.assets.USDT.frozen, order.amount)
  const early = await api('POST', `/api/otc/orders/${order.id}/release`)
  assert.equal(early.code, 3005)
  await sleep(120)
  const released = await api('POST', `/api/otc/orders/${order.id}/release`)
  assert.equal(released.data.status, 'completed')
  me = (await api('GET', '/api/user/me')).data
  assert.equal(me.assets.USDT.frozen, 0)
})

test('取消买单后广告库存恢复', async () => {
  const [ad] = (await api('GET', '/api/otc/ads?side=buy&coin=ETH')).data
  const available = ad.available
  const order = (await api('POST', '/api/otc/orders', { adId: ad.id, fiatAmount: 1000, payMethod: 'bank' })).data
  const cancelled = await api('POST', `/api/otc/orders/${order.id}/cancel`)
  assert.equal(cancelled.data.status, 'cancelled')
  const adAfter = (await api('GET', `/api/otc/ads/${ad.id}`)).data
  assert.equal(adAfter.available, available)
})

test('钱包绑定：签名验签', async () => {
  const wallet = Wallet.createRandom()
  const { message } = (await api('GET', '/api/user/wallet/nonce')).data
  const signature = await wallet.signMessage(message)
  const other = Wallet.createRandom()
  const mismatch = await api('POST', '/api/user/wallet', { address: other.address, signature })
  assert.equal(mismatch.code, 1103)
  const ok = await api('POST', '/api/user/wallet', { address: wallet.address, signature })
  assert.equal(ok.data.wallet.address, wallet.address)
  // nonce 只能用一次，防止签名被重放
  const replay = await api('POST', '/api/user/wallet', { address: wallet.address, signature })
  assert.equal(replay.code, 1101)
})

test('埋点上报与统计', async () => {
  await api('POST', '/api/track', {
    events: [
      { type: 'page_view', page: 'pages/market/market' },
      { type: 'api', url: '/api/market/tickers', duration: 30, ok: true }
    ]
  })
  const stats = (await api('GET', '/api/track/stats')).data
  assert.equal(stats.pageViews['pages/market/market'], 1)
  assert.equal(stats.api['/api/market/tickers'].avg, 30)
})
