import { http } from '@/utils/request'
import type { Ad, Order, OrderStatus, OtcConfig, PayMethod, TradeSide } from '@/types'

export const getOtcConfig = () => http.get<OtcConfig>('/api/otc/config')

export const getAds = (params: { side: TradeSide; coin: string; payMethod?: PayMethod | '' }) =>
  http.get<Ad[]>('/api/otc/ads', params)

export const getAd = (id: string) => http.get<Ad>(`/api/otc/ads/${id}`)

export const createOrder = (data: { adId: string; fiatAmount: number; payMethod: PayMethod }) =>
  http.post<Order>('/api/otc/orders', data)

export const getOrders = (status?: OrderStatus) => http.get<Order[]>('/api/otc/orders', status ? { status } : {})

export const getOrder = (id: string) => http.get<Order>(`/api/otc/orders/${id}`)

export const payOrder = (id: string) => http.post<Order>(`/api/otc/orders/${id}/pay`)

export const releaseOrder = (id: string) => http.post<Order>(`/api/otc/orders/${id}/release`)

export const cancelOrder = (id: string) => http.post<Order>(`/api/otc/orders/${id}/cancel`)
