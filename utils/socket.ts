// WebSocket 封装（基于 uni.connectSocket，H5 / App / 小程序通用）
// - 按频道订阅，多个页面订阅同一频道只发一次 sub，全部取消后才 unsub
// - 心跳：每 15 秒 ping，5 秒内没收到 pong 视为断线
// - 断线重连：指数退避 1s、2s、4s … 最多 30s，重连后自动恢复订阅和登录态
import { reactive } from 'vue'
import { WS_URL } from '@/config'

type Handler = (data: any) => void
type Status = 'idle' | 'connecting' | 'open' | 'closed'

const HEARTBEAT_INTERVAL = 15000
const PONG_TIMEOUT = 5000
const MAX_RETRY_DELAY = 30000

export const socketState = reactive<{ status: Status; retry: number }>({ status: 'idle', retry: 0 })

class SocketClient {
  private task: UniApp.SocketTask | null = null
  private handlers = new Map<string, Set<Handler>>()
  private token = ''
  private manualClose = false
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null
  private pongTimer: ReturnType<typeof setTimeout> | null = null
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null

  connect() {
    if (this.task) return
    this.manualClose = false
    socketState.status = 'connecting'
    const task = uni.connectSocket({ url: WS_URL, complete: () => {} })
    this.task = task

    task.onOpen(() => {
      socketState.status = 'open'
      socketState.retry = 0
      this.startHeartbeat()
      if (this.token) this.send({ op: 'auth', token: this.token })
      for (const channel of this.handlers.keys()) this.send({ op: 'sub', channel })
    })

    task.onMessage((res) => {
      let msg: any
      try {
        msg = JSON.parse(res.data as string)
      } catch {
        return
      }
      if (msg.op === 'pong') {
        if (this.pongTimer) clearTimeout(this.pongTimer)
        this.pongTimer = null
        return
      }
      // 带 op 的是控制消息（subscribed / auth / error），只有数据推送才分发给订阅者
      if (msg.op || !msg.channel || msg.data === undefined) return
      this.handlers.get(msg.channel)?.forEach((h) => h(msg.data))
    })

    task.onClose(() => this.handleClose())
    task.onError(() => this.handleClose())
  }

  private handleClose() {
    if (!this.task) return
    this.task = null
    this.stopHeartbeat()
    socketState.status = 'closed'
    if (!this.manualClose) this.scheduleReconnect()
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) return
    const delay = Math.min(1000 * 2 ** socketState.retry, MAX_RETRY_DELAY)
    socketState.retry++
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.connect()
    }, delay)
  }

  private startHeartbeat() {
    this.stopHeartbeat()
    this.heartbeatTimer = setInterval(() => {
      this.send({ op: 'ping' })
      this.pongTimer = setTimeout(() => this.task?.close({}), PONG_TIMEOUT)
    }, HEARTBEAT_INTERVAL)
  }

  private stopHeartbeat() {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer)
    if (this.pongTimer) clearTimeout(this.pongTimer)
    this.heartbeatTimer = null
    this.pongTimer = null
  }

  private send(msg: Record<string, unknown>) {
    if (socketState.status === 'open') this.task?.send({ data: JSON.stringify(msg) })
  }

  // 返回取消订阅函数，方便在 onHide / onUnload 中调用
  subscribe(channel: string, handler: Handler) {
    let set = this.handlers.get(channel)
    if (!set) {
      set = new Set()
      this.handlers.set(channel, set)
      this.send({ op: 'sub', channel })
    }
    set.add(handler)
    return () => this.unsubscribe(channel, handler)
  }

  unsubscribe(channel: string, handler: Handler) {
    const set = this.handlers.get(channel)
    if (!set) return
    set.delete(handler)
    if (!set.size) {
      this.handlers.delete(channel)
      this.send({ op: 'unsub', channel })
    }
  }

  setToken(token: string) {
    this.token = token
    if (token) this.send({ op: 'auth', token })
  }

  // App 从后台回到前台时调用：连接已断则立即重连，不等退避计时
  ensureConnected() {
    if (this.task) return
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.reconnectTimer = null
    socketState.retry = 0
    this.connect()
  }

  close() {
    this.manualClose = true
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.reconnectTimer = null
    this.task?.close({})
  }
}

export const socket = new SocketClient()
