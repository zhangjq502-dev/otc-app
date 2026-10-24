// WebSocket 推送：客户端按频道订阅
// 客户端消息：{ op: 'sub' | 'unsub', channel } / { op: 'auth', token } / { op: 'ping' }
// 频道：tickers（全部行情）、kline:BTC:15m（K 线最新一根）、orders（当前用户订单变化，需先 auth）
import { WebSocketServer } from 'ws'
import { verifyToken } from './app.js'

export function attachWebSocket(server, { store, market }) {
  const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 16 * 1024 })

  const send = (ws, msg) => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg))
  }

  wss.on('connection', (ws) => {
    ws.channels = new Set()
    ws.userId = null
    ws.isAlive = true

    ws.on('message', async (raw) => {
      try {
      let msg
      try {
        msg = JSON.parse(raw.toString())
      } catch {
        return send(ws, { op: 'error', message: '消息必须是 JSON' })
      }
      ws.isAlive = true
      switch (msg.op) {
        case 'ping':
          return send(ws, { op: 'pong', time: Date.now() })
        case 'auth': {
          ws.userId = null
          const uid = verifyToken(msg.token)
          if (uid) { await store.getUser(uid); ws.userId = uid }
          return send(ws, { op: 'auth', ok: Boolean(ws.userId) })
        }
        case 'sub': {
          if (typeof msg.channel !== 'string') return
          if (!['tickers', 'orders'].includes(msg.channel) && !/^kline:[A-Z0-9]+:(1m|5m|15m|1h|4h)$/.test(msg.channel)) return
          if (ws.channels.size >= 32) return
          ws.channels.add(msg.channel)
          send(ws, { op: 'subscribed', channel: msg.channel })
          // 订阅后立即推一次快照，避免页面等待下一次 tick
          if (msg.channel === 'tickers') send(ws, { channel: 'tickers', data: market.getTickers() })
          return
        }
        case 'unsub':
          ws.channels.delete(msg.channel)
          return send(ws, { op: 'unsubscribed', channel: msg.channel })
        default:
          return send(ws, { op: 'error', message: `未知操作 ${msg.op}` })
      }
      } catch { send(ws, { op: 'error', message: '请求无效或登录已失效' }) }
    })
  })

  market.on('tick', (tickers) => {
    const klineCache = new Map()
    for (const ws of wss.clients) {
      for (const channel of ws.channels) {
        if (channel === 'tickers') {
          send(ws, { channel, data: tickers })
        } else if (channel.startsWith('kline:')) {
          if (!klineCache.has(channel)) {
            const [, symbol, interval] = channel.split(':')
            const list = market.getKlines(symbol, interval, 1)
            klineCache.set(channel, list ? list[list.length - 1] : null)
          }
          const candle = klineCache.get(channel)
          if (candle) send(ws, { channel, data: candle })
        }
      }
    }
  })

  store.on('order', (order) => {
    for (const ws of wss.clients) {
      if (ws.userId === order.userId && ws.channels.has('orders')) {
        send(ws, { channel: 'orders', data: order })
      }
    }
  })

  // 服务端心跳：30 秒内没有任何消息的连接视为断开
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.isAlive) {
        ws.terminate()
        continue
      }
      ws.isAlive = false
    }
  }, 30000)
  wss.on('close', () => clearInterval(heartbeat))

  return wss
}
