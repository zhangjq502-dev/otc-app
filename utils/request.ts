// uni.request 的 Promise 封装：统一 baseURL、token、错误提示、401 处理、接口耗时埋点
import { BASE_URL } from '@/config'
import type { ApiResponse } from '@/types'
import { tracker } from './tracker'

export class ApiError extends Error {
  constructor(
    public code: number,
    message: string,
    public status = 0
  ) {
    super(message)
  }
}

type Method = 'GET' | 'POST' | 'PUT' | 'DELETE'

interface RequestOptions {
  url: string
  method?: Method
  data?: Record<string, unknown>
  // 为 true 时不弹出错误提示，由调用方自己处理
  silent?: boolean
}

let redirectingToLogin = false

function handleUnauthorized() {
  uni.removeStorageSync('token')
  uni.$emit('auth:expired')
  const pages = getCurrentPages()
  const route = pages[pages.length - 1]?.route
  if (redirectingToLogin || route === 'pages/login/login') return
  redirectingToLogin = true
  uni.navigateTo({
    url: '/pages/login/login',
    complete: () => (redirectingToLogin = false)
  })
}

export function request<T>({ url, method = 'GET', data, silent = false }: RequestOptions): Promise<T> {
  const token = uni.getStorageSync('token')
  const start = Date.now()
  return new Promise((resolve, reject) => {
    uni.request({
      url: BASE_URL + url,
      method,
      data,
      timeout: 10000,
      header: token ? { Authorization: `Bearer ${token}` } : {},
      success(res) {
        const body = res.data as ApiResponse<T>
        const ok = res.statusCode === 200 && body?.code === 0
        tracker.api({
          url: url.split('?')[0],
          method,
          duration: Date.now() - start,
          status: res.statusCode,
          ok,
          code: body?.code
        })
        if (ok) return resolve(body.data)
        const err = new ApiError(body?.code ?? res.statusCode, body?.message || '请求失败', res.statusCode)
        if (res.statusCode === 401) handleUnauthorized()
        else if (!silent) uni.showToast({ title: err.message, icon: 'none' })
        reject(err)
      },
      fail(e) {
        tracker.api({ url: url.split('?')[0], method, duration: Date.now() - start, status: 0, ok: false })
        if (!silent) uni.showToast({ title: '网络异常，请检查后端服务是否启动', icon: 'none' })
        reject(new ApiError(-1, e.errMsg || '网络异常'))
      }
    })
  })
}

export const http = {
  get: <T>(url: string, data?: Record<string, unknown>, silent?: boolean) => request<T>({ url, data, silent }),
  post: <T>(url: string, data?: Record<string, unknown>, silent?: boolean) =>
    request<T>({ url, method: 'POST', data, silent })
}
