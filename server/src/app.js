import express from 'express'
import cors from 'cors'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import jwt from 'jsonwebtoken'
import { randomBytes } from 'node:crypto'
import { verifyMessage, isAddress, getAddress } from 'ethers'
import { config } from './config.js'
import { AppError, OTC_COINS, PAY_METHODS } from './store.js'
import { INTERVALS } from './market.js'

const ok = (res, data = null) => res.json({ code: 0, message: 'ok', data })

export function signToken(user) {
  return jwt.sign({ uid: user.id }, config.jwtSecret, { expiresIn: config.jwtExpiresIn })
}

export function verifyToken(token) {
  try {
    return jwt.verify(token, config.jwtSecret).uid
  } catch {
    return null
  }
}

export function createApp({ store, market }) {
  const app = express()
  app.use(cors())
  app.use(express.json({ limit: '200kb' }))

  // 简单的请求日志
  app.use((req, res, next) => {
    const start = Date.now()
    res.on('finish', () => {
      if (process.env.NODE_ENV !== 'test') {
        console.log(`${req.method} ${req.originalUrl} ${res.statusCode} ${Date.now() - start}ms`)
      }
    })
    next()
  })

  const auth = (req, res, next) => {
    const token = (req.headers.authorization || '').replace(/^Bearer /, '')
    const uid = token && verifyToken(token)
    if (!uid || !store.users.has(uid)) return next(new AppError(401, '请先登录', 401))
    req.userId = uid
    next()
  }

  const walletNonces = new Map()

  app.get('/api/health', (req, res) => ok(res, { time: Date.now() }))

  // ---------- 认证 ----------
  app.post('/api/auth/register', (req, res) => {
    const user = store.createUser(req.body.username, req.body.password)
    ok(res, { token: signToken(user), user: store.publicUser(user) })
  })

  app.post('/api/auth/login', (req, res) => {
    const user = store.login(req.body.username, req.body.password)
    ok(res, { token: signToken(user), user: store.publicUser(user) })
  })

  app.get('/api/user/me', auth, (req, res) => ok(res, store.publicUser(store.getUser(req.userId))))

  // 钱包绑定：先取 nonce，钱包对含 nonce 的消息签名，后端验签恢复地址
  app.get('/api/user/wallet/nonce', auth, (req, res) => {
    const nonce = randomBytes(8).toString('hex')
    walletNonces.set(req.userId, nonce)
    ok(res, { message: `绑定钱包到 OTC 账户\nnonce: ${nonce}` })
  })

  app.post('/api/user/wallet', auth, (req, res) => {
    const { address, signature } = req.body
    const nonce = walletNonces.get(req.userId)
    if (!nonce) throw new AppError(1101, '请先获取签名消息')
    if (!isAddress(address)) throw new AppError(1102, '钱包地址格式错误')
    let recovered
    try {
      recovered = verifyMessage(`绑定钱包到 OTC 账户\nnonce: ${nonce}`, signature)
    } catch {
      throw new AppError(1103, '签名无效')
    }
    if (getAddress(recovered) !== getAddress(address)) throw new AppError(1103, '签名与地址不匹配')
    walletNonces.delete(req.userId)
    ok(res, store.publicUser(store.bindWallet(req.userId, getAddress(address))))
  })

  // ---------- 行情 ----------
  app.get('/api/market/tickers', (req, res) => ok(res, market.getTickers()))

  app.get('/api/market/ticker/:symbol', (req, res) => {
    const ticker = market.getTicker(req.params.symbol.toUpperCase())
    if (!ticker) throw new AppError(4001, '币种不存在', 404)
    ok(res, ticker)
  })

  app.get('/api/market/klines', (req, res) => {
    const symbol = String(req.query.symbol || '').toUpperCase()
    const interval = String(req.query.interval || '15m')
    if (!INTERVALS[interval]) throw new AppError(4002, `周期仅支持 ${Object.keys(INTERVALS).join(', ')}`)
    const klines = market.getKlines(symbol, interval, Number(req.query.limit) || 120)
    if (!klines) throw new AppError(4001, '币种不存在', 404)
    ok(res, klines)
  })

  // ---------- OTC ----------
  app.get('/api/otc/config', (req, res) => ok(res, { coins: OTC_COINS, fiat: 'CNY', payMethods: PAY_METHODS }))

  app.get('/api/otc/ads', (req, res) => {
    ok(res, store.listAds({ side: req.query.side, coin: req.query.coin, payMethod: req.query.payMethod }))
  })

  app.get('/api/otc/ads/:id', (req, res) => ok(res, store.getAd(req.params.id)))

  app.post('/api/otc/orders', auth, (req, res) => ok(res, store.createOrder(req.userId, req.body)))

  app.get('/api/otc/orders', auth, (req, res) => ok(res, store.listOrders(req.userId, req.query.status)))

  app.get('/api/otc/orders/:id', auth, (req, res) => ok(res, store.getOrder(req.userId, req.params.id)))

  app.post('/api/otc/orders/:id/pay', auth, (req, res) => ok(res, store.markPaid(req.params.id, req.userId)))

  app.post('/api/otc/orders/:id/release', auth, (req, res) => ok(res, store.release(req.params.id, req.userId)))

  app.post('/api/otc/orders/:id/cancel', auth, (req, res) => ok(res, store.cancelOrder(req.params.id, req.userId)))

  // ---------- 埋点 ----------
  app.post('/api/track', (req, res) => {
    const token = (req.headers.authorization || '').replace(/^Bearer /, '')
    const count = store.addEvents(req.body.events, { userId: token ? verifyToken(token) : null, ua: req.headers['user-agent'] })
    ok(res, { count })
  })

  app.get('/api/track/stats', (req, res) => ok(res, store.trackStats()))

  // 线上部署：托管 H5 打包产物（server/public），页面与接口同域名，无需跨域
  const publicDir = fileURLToPath(new URL('../public', import.meta.url))
  if (existsSync(publicDir)) {
    app.use(
      express.static(publicDir, {
        maxAge: '7d',
        // index.html 不缓存：重新部署后能立即拿到引用新文件名的页面
        setHeaders: (res, file) => {
          if (file.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache')
        }
      })
    )
  }

  app.use((req, res) => res.status(404).json({ code: 404, message: '接口不存在', data: null }))

  // 统一错误处理
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err instanceof AppError) {
      return res.status(err.status).json({ code: err.code, message: err.message, data: null })
    }
    if (err.type === 'entity.parse.failed') {
      return res.status(400).json({ code: 400, message: '请求体不是合法 JSON', data: null })
    }
    console.error(err)
    res.status(500).json({ code: 500, message: '服务器内部错误', data: null })
  })

  return app
}
