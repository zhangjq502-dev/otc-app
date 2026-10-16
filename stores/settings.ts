import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'

// 涨跌颜色：国际交易所习惯绿涨红跌，A 股习惯红涨绿跌
export type ColorMode = 'green-up' | 'red-up'

const GREEN = '#0ecb81'
const RED = '#f6465d'

export const useSettingsStore = defineStore('settings', () => {
  const colorMode = ref<ColorMode>(uni.getStorageSync('colorMode') || 'green-up')

  const upColor = computed(() => (colorMode.value === 'green-up' ? GREEN : RED))
  const downColor = computed(() => (colorMode.value === 'green-up' ? RED : GREEN))
  const trendColor = (change: number) => (change >= 0 ? upColor.value : downColor.value)

  watch(colorMode, (v) => uni.setStorageSync('colorMode', v))

  return { colorMode, upColor, downColor, trendColor }
})
