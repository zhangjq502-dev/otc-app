import { http } from '@/utils/request'
import type { Kline, KlineInterval, Ticker } from '@/types'

export const getTickers = () => http.get<Ticker[]>('/api/market/tickers')

export const getTicker = (symbol: string) => http.get<Ticker>(`/api/market/ticker/${symbol}`)

export const getKlines = (symbol: string, interval: KlineInterval, limit = 120) =>
  http.get<Kline[]>('/api/market/klines', { symbol, interval, limit })
