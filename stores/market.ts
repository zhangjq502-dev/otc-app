import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type { Ticker } from '@/types'
import { getTickers } from '@/api/market'
import { socket } from '@/utils/socket'

export const useMarketStore = defineStore('market', () => {
  const tickers = ref<Record<string, Ticker>>({})
  // 记录每个币种最近一次价格变动方向，用于列表闪烁效果
  const flash = ref<Record<string, 'up' | 'down' | ''>>({})
  const updatedAt = ref(0)

  const list = computed(() => Object.values(tickers.value))

  function apply(data: Ticker[]) {
    const next: Record<string, Ticker> = {}
    const nextFlash: Record<string, 'up' | 'down' | ''> = {}
    for (const t of data) {
      const prev = tickers.value[t.symbol]
      nextFlash[t.symbol] = !prev || prev.price === t.price ? '' : t.price > prev.price ? 'up' : 'down'
      next[t.symbol] = t
    }
    tickers.value = next
    flash.value = nextFlash
    updatedAt.value = Date.now()
  }

  // REST 拉一次快照：首屏和下拉刷新用，WebSocket 不可用时也能看到数据
  async function refresh() {
    apply(await getTickers())
  }

  // 订阅实时推送，返回取消订阅函数
  // 每次包一层新函数：多个页面各自持有独立的 handler，
  // 避免详情页 onUnload 取消订阅时把行情页的订阅一起删掉
  function subscribe() {
    return socket.subscribe('tickers', (data: Ticker[]) => apply(data))
  }

  return { tickers, flash, updatedAt, list, refresh, subscribe }
})
