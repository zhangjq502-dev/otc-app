import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { TradeSide } from '@/types'

// OTC 页的筛选条件。switchTab 不能带参数，
// 详情页点「买入 / 卖出」时先写入这里，再切到 OTC tab
export const useOtcStore = defineStore('otc', () => {
  const side = ref<TradeSide>('buy')
  const coin = ref('USDT')

  function preset(nextSide: TradeSide, nextCoin: string) {
    side.value = nextSide
    coin.value = nextCoin
  }

  return { side, coin, preset }
})
