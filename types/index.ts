export interface ApiResponse<T> {
  code: number
  message: string
  data: T
}

export interface Ticker {
  symbol: string
  quote: string
  price: number
  open: number
  high: number
  low: number
  change: number
  volume: number
  turnover: number
  digits: number
  time: number
}

export interface Kline {
  time: number
  open: number
  high: number
  low: number
  close: number
  volume: number
}

export type KlineInterval = '1m' | '5m' | '15m' | '1h' | '4h'

export type TradeSide = 'buy' | 'sell'
export type PayMethod = 'bank' | 'alipay' | 'wechat'

export interface Merchant {
  name: string
  orders: number
  rate: number
  online: boolean
}

export interface Ad {
  id: string
  side: TradeSide
  coin: string
  fiat: string
  price: number
  available: number
  minAmount: number
  maxAmount: number
  payMethods: PayMethod[]
  merchant: Merchant
}

export type OrderStatus = 'pending' | 'paid' | 'completed' | 'cancelled'

export interface Order {
  id: string
  adId: string
  side: TradeSide
  coin: string
  fiat: string
  price: number
  amount: number
  total: number
  payMethod: PayMethod
  payMethodName: string
  merchant: { name: string }
  payee: { name: string; account: string }
  status: OrderStatus
  createdAt: number
  expireAt: number
  paidAt: number | null
  completedAt: number | null
  cancelReason: string | null
}

export interface Asset {
  available: number
  frozen: number
}

export interface User {
  role?: 'admin' | 'user'
  id: string
  username: string
  nickname: string
  wallet: { address: string; boundAt: number } | null
  createdAt: number
  assets: Record<string, Asset>
}

export interface OtcConfig {
  coins: string[]
  fiat: string
  payMethods: Record<PayMethod, string>
}
