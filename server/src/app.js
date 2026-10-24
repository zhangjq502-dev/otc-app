import express from 'express'
import cors from 'cors'
import rateLimit from 'express-rate-limit'
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
  app.disable('x-powered-by')
  if (config.trustProxyHops > 0) app.set('trust proxy', config.trustProxyHops)
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('Referrer-Policy', 'no-referrer')
    next()
  })
  app.use(cors({ origin(origin, cb) {
    cb(null, !origin || config.allowedOrigins.includes(origin))
  } }))
  // Express 4 does not forward rejected async handlers automatically.
  for (const verb of ['get', 'post']) {
    const register = app[verb].bind(app)
    app[verb] = (path, ...handlers) => handlers.length
      ? register(path, ...handlers.map(handler =>
        (req, res, next) => Promise.resolve().then(() => handler(req,res,next)).catch(next)))
      : register(path)
  }
  app.use(express.json({ limit: '200kb' }))
  app.use('/api', (req,res,next) => {
    res.setHeader('Cache-Control','no-store')
    if (req.method === 'POST' && (!req.body || typeof req.body !== 'object' || Array.isArray(req.body))) {
      return next(new AppError(400, '请求体必须为 JSON 对象'))
    }
    next()
  })
  app.use('/api/auth', rateLimit({ windowMs: 15 * 60 * 1000, limit: 30,
    standardHeaders: 'draft-7', legacyHeaders: false,
    message: { code:429, message:'请求过于频繁，请稍后重试', data:null } }))
  app.use('/api/track', rateLimit({ windowMs:60000, limit:120,
    message: { code:429, message:'请求过于频繁', data:null } }))

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

  const auth = async (req, res, next) => {
    const token = (req.headers.authorization || '').replace(/^Bearer /, '')
    const uid = token && verifyToken(token)
    if (!uid) return next(new AppError(401, '请先登录', 401))
    await store.getUser(uid)
    req.userId = uid
    next()
  }

  const walletNonces = new Map()

  app.get('/api/health', async (req, res) => {
    if (store.ping) await store.ping()
    ok(res, { time: Date.now(), storage: store.ping ? 'postgres' : 'memory' })
  })

  // ---------- 认证 ----------
  app.post('/api/auth/register', async (req, res) => {
    const user = await store.createUser(req.body.username, req.body.password)
    ok(res, { token: signToken(user), user: store.publicUser(user) })
  })

  app.post('/api/auth/login', async (req, res) => {
    const user = await store.login(req.body.username, req.body.password)
    ok(res, { token: signToken(user), user: store.publicUser(user) })
  })

  app.get('/api/user/me', auth, async (req, res) => ok(res, store.publicUser(await store.getUser(req.userId))))

  // 钱包绑定：先取 nonce，钱包对含 nonce 的消息签名，后端验签恢复地址
  app.get('/api/user/wallet/nonce', auth, async (req, res) => {
    const nonce = randomBytes(8).toString('hex')
    if (store.issueChallenge) await store.issueChallenge(req.userId, nonce)
    else walletNonces.set(req.userId, { nonce, expiresAt: Date.now() + 300000 })
    ok(res, { message: `绑定钱包到 OTC 账户\nnonce: ${nonce}` })
  })

  app.post('/api/user/wallet', auth, async (req, res) => {
    const { address, signature } = req.body
    const local = walletNonces.get(req.userId)
    const nonce = store.getChallenge ? await store.getChallenge(req.userId) : (local?.expiresAt > Date.now() ? local.nonce : null)
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
    const user = store.consumeChallenge
      ? await store.consumeChallenge(req.userId, nonce, getAddress(address))
      : await store.bindWallet(req.userId, getAddress(address))
    ok(res, store.publicUser(user))
  })

  // ---------- 行情 ----------
  app.get('/api/market/tickers', async (req, res) => ok(res, market.getTickers()))

  app.get('/api/market/ticker/:symbol', async (req, res) => {
    const ticker = market.getTicker(req.params.symbol.toUpperCase())
    if (!ticker) throw new AppError(4001, '币种不存在', 404)
    ok(res, ticker)
  })

  app.get('/api/market/klines', async (req, res) => {
    const symbol = String(req.query.symbol || '').toUpperCase()
    const interval = String(req.query.interval || '15m')
    if (!INTERVALS[interval]) throw new AppError(4002, `周期仅支持 ${Object.keys(INTERVALS).join(', ')}`)
    const klines = market.getKlines(symbol, interval, Number(req.query.limit) || 120)
    if (!klines) throw new AppError(4001, '币种不存在', 404)
    ok(res, klines)
  })

  // ---------- OTC ----------
  app.get('/api/otc/config', async (req, res) => ok(res, { coins: OTC_COINS, fiat: 'CNY', payMethods: PAY_METHODS }))

  app.get('/api/otc/ads', async (req, res) => {
    ok(res, await store.listAds({ side: req.query.side, coin: req.query.coin, payMethod: req.query.payMethod }))
  })

  app.get('/api/otc/ads/:id', async (req, res) => ok(res, await store.getAd(req.params.id)))

  app.post('/api/otc/orders', auth, async (req, res) => ok(res, await store.createOrder(req.userId, req.body, req.headers['idempotency-key'])))

  app.get('/api/otc/orders', auth, async (req, res) => ok(res, await store.listOrders(req.userId, req.query.status)))

  app.get('/api/otc/orders/:id', auth, async (req, res) => ok(res, await store.getOrder(req.userId, req.params.id)))

  app.post('/api/otc/orders/:id/pay', auth, async (req, res) => ok(res, await store.markPaid(req.params.id, req.userId)))

  app.post('/api/otc/orders/:id/release', auth, async (req, res) => ok(res, await store.release(req.params.id, req.userId)))

  app.post('/api/otc/orders/:id/cancel', auth, async (req, res) => ok(res, await store.cancelOrder(req.params.id, req.userId)))

  // ---------- 埋点 ----------
  app.post('/api/track', async (req, res) => {
    const token = (req.headers.authorization || '').replace(/^Bearer /, '')
    const count = store.addEvents(req.body.events, { userId: token ? verifyToken(token) : null, ua: req.headers['user-agent'] })
    ok(res, { count })
  })

  app.get('/api/track/stats', auth, async (req, res) => {
    if (process.env.NODE_ENV === 'production' && (!config.adminToken || req.headers['x-admin-token'] !== config.adminToken)) {
      throw new AppError(403, '需要管理员权限', 403)
    }
    ok(res, store.trackStats())
  })

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

  app.use(async (req, res) => res.status(404).json({ code: 404, message: '接口不存在', data: null }))

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
