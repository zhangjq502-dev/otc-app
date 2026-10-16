import http from 'node:http'
import { config } from './config.js'
import { createApp } from './app.js'
import { attachWebSocket } from './ws.js'
import { MarketEngine } from './market.js'
import { Store } from './store.js'

const store = new Store()
const market = new MarketEngine()
const server = http.createServer(createApp({ store, market }))
const wss = attachWebSocket(server, { store, market })

market.start(config.tickInterval)

server.listen(config.port, '0.0.0.0', () => {
  console.log(`OTC server running at http://localhost:${config.port}`)
  console.log(`WebSocket: ws://localhost:${config.port}/ws`)
  console.log('演示账号：demo / 123456')
})

// 退出时主动断开所有 WebSocket 客户端：ws 的 close() 不会断开已有连接，
// 否则旧进程会一直占着连接，客户端感知不到断线，也就不会重连到新进程
const shutdown = () => {
  market.stop()
  store.shutdown()
  for (const client of wss.clients) client.terminate()
  wss.close()
  server.close(() => process.exit(0))
  setTimeout(() => process.exit(0), 2000).unref()
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
