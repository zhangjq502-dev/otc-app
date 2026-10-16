// 轻量埋点 / 监控 SDK：页面访问、接口耗时、JS 错误、自定义点击、H5 首屏性能
// 事件先进队列，满 10 条或每 5 秒批量上报，减少请求数；App 切后台时立即上报
import { BASE_URL } from '@/config'

export interface TrackEvent {
  type: 'page_view' | 'api' | 'error' | 'click' | 'perf'
  time: number
  page: string
  platform: string
  sessionId: string
  [key: string]: unknown
}

const FLUSH_SIZE = 10
const FLUSH_INTERVAL = 5000
const REPORT_URL = `${BASE_URL}/api/track`

const sessionId = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
let platform = 'unknown'
try {
  platform = uni.getSystemInfoSync().uniPlatform || 'unknown'
} catch {
  // 部分平台初始化早期取不到系统信息
}

const queue: TrackEvent[] = []
let timer: ReturnType<typeof setTimeout> | null = null

function currentPage(): string {
  const pages = getCurrentPages()
  return pages.length ? pages[pages.length - 1].route || '' : ''
}

function push(type: TrackEvent['type'], data: Record<string, unknown> = {}) {
  queue.push({ type, time: Date.now(), page: currentPage(), platform, sessionId, ...data })
  if (queue.length >= FLUSH_SIZE) flush()
  else if (!timer) timer = setTimeout(flush, FLUSH_INTERVAL)
}

// 返回 Promise，需要确认上报完成的地方（如监控面板）可以 await
export function flush(): Promise<void> {
  if (timer) {
    clearTimeout(timer)
    timer = null
  }
  if (!queue.length) return Promise.resolve()
  const events = queue.splice(0, queue.length)
  const token = uni.getStorageSync('token')
  return new Promise((resolve) => {
    // 直接用 uni.request，不走封装的 request，避免上报请求本身又被记录
    uni.request({
      url: REPORT_URL,
      method: 'POST',
      data: { events },
      header: token ? { Authorization: `Bearer ${token}` } : {},
      fail() {
        // 上报失败放回队列头部，下次再发；超过上限丢弃最旧的
        queue.unshift(...events.slice(-50))
      },
      complete: () => resolve()
    })
  })
}

export const tracker = {
  pageView(page: string) {
    push('page_view', { page })
  },
  api(data: { url: string; method: string; duration: number; status: number; ok: boolean; code?: number }) {
    // 把路径里的数字 id 归一成 :id，同一个接口的耗时才能聚合统计
    push('api', { ...data, url: data.url.replace(/\/\d+(?=\/|$)/g, '/:id') })
  },
  error(err: unknown, extra: Record<string, unknown> = {}) {
    const e = err instanceof Error ? err : new Error(String(err))
    push('error', { message: e.message, stack: e.stack?.slice(0, 1000), ...extra })
  },
  click(name: string, data: Record<string, unknown> = {}) {
    push('click', { name, ...data })
  },
  // H5 首屏性能：读取 Performance API
  collectPerf() {
    // #ifdef H5
    setTimeout(() => {
      const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined
      const fcp = performance.getEntriesByName('first-contentful-paint')[0]
      push('perf', {
        fcp: fcp ? Math.round(fcp.startTime) : null,
        domReady: nav ? Math.round(nav.domContentLoadedEventEnd) : null,
        load: nav ? Math.round(nav.loadEventEnd) : null
      })
    }, 0)
    // #endif
  },
  flush
}

// 通过全局 mixin 自动采集页面访问：每个页面 onShow 时记录一次
export const trackerPlugin = {
  install(app: { mixin: (m: Record<string, unknown>) => void }) {
    app.mixin({
      onShow(this: { $mpType?: string }) {
        if (this.$mpType === 'page') tracker.pageView(currentPage())
      }
    })
    // H5 端：setTimeout、事件回调里抛出的错误不会经过 App 的 onError，
    // 需要监听 window 的 error / unhandledrejection 兜底
    // #ifdef H5
    window.addEventListener('error', (e) => tracker.error(e.error || e.message, { kind: 'window.error' }))
    window.addEventListener('unhandledrejection', (e) => tracker.error(e.reason, { kind: 'unhandledrejection' }))
    // #endif
  }
}
