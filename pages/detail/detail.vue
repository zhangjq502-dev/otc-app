<template>
	<view class="page">
		<view class="summary">
			<view class="left">
				<text class="price num" :style="{ color: trendColor }">
					{{ ticker ? formatPrice(ticker.price, ticker.digits > 2 ? 4 : 2) : '--' }}
				</text>
				<text class="change num" :style="{ color: trendColor }">
					{{ ticker ? formatPercent(ticker.change) : '--' }}
				</text>
			</view>
			<view class="stats">
				<view class="stat">
					<text class="muted">24h 最高</text>
					<text class="num">{{ ticker ? formatPrice(ticker.high) : '--' }}</text>
				</view>
				<view class="stat">
					<text class="muted">24h 最低</text>
					<text class="num">{{ ticker ? formatPrice(ticker.low) : '--' }}</text>
				</view>
				<view class="stat">
					<text class="muted">24h 成交额</text>
					<text class="num">{{ ticker ? formatCompact(ticker.turnover) : '--' }}</text>
				</view>
			</view>
		</view>

		<view class="chart-card">
			<view class="intervals">
				<text
					v-for="item in intervals"
					:key="item"
					class="interval"
					:class="{ active: interval === item }"
					@click="changeInterval(item)"
				>
					{{ item }}
				</text>
			</view>
			<view class="legend num">
				<template v-if="selected">
					<text>开 {{ formatPrice(selected.open) }}</text>
					<text>高 {{ formatPrice(selected.high) }}</text>
					<text>低 {{ formatPrice(selected.low) }}</text>
					<text>收 {{ formatPrice(selected.close) }}</text>
				</template>
				<template v-else>
					<text class="ma5">MA5</text>
					<text class="ma10">MA10</text>
					<text class="muted">按住图表查看详情</text>
				</template>
			</view>
			<kline-chart
				v-if="klines.length"
				:klines="klines"
				:up-color="settings.upColor"
				:down-color="settings.downColor"
				:intraday="interval !== '4h'"
				:height="320"
				@select="selected = $event"
			/>
			<view v-else class="chart-loading muted">K 线加载中…</view>
		</view>

		<view class="tip muted">行情为后端模拟数据，仅用于演示</view>

		<view class="actions">
			<button class="action buy" :style="{ backgroundColor: settings.upColor }" @click="goTrade('buy')">
				买入 {{ symbol }}
			</button>
			<button class="action sell" :style="{ backgroundColor: settings.downColor }" @click="goTrade('sell')">
				卖出 {{ symbol }}
			</button>
		</view>
	</view>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { onLoad, onUnload } from '@dcloudio/uni-app'
import KlineChart from '@/components/kline-chart/kline-chart.vue'
import { getKlines } from '@/api/market'
import { useMarketStore } from '@/stores/market'
import { useSettingsStore } from '@/stores/settings'
import { useOtcStore } from '@/stores/otc'
import { socket } from '@/utils/socket'
import { formatCompact, formatPercent, formatPrice } from '@/utils/format'
import type { Kline, KlineInterval } from '@/types'

const market = useMarketStore()
const settings = useSettingsStore()
const otc = useOtcStore()

const intervals: KlineInterval[] = ['1m', '5m', '15m', '1h', '4h']
const symbol = ref('')
const interval = ref<KlineInterval>('15m')
const klines = ref<Kline[]>([])
const selected = ref<Kline | null>(null)

const ticker = computed(() => market.tickers[symbol.value])
const trendColor = computed(() => (ticker.value ? settings.trendColor(ticker.value.change) : ''))

let unsubTicker: (() => void) | null = null
let unsubKline: (() => void) | null = null

// 推送来的最新一根 K 线：同一时间则替换最后一根，否则追加
function onKline(candle: Kline) {
	const list = klines.value
	if (!list.length) return
	const last = list[list.length - 1]
	if (candle.time === last.time) list.splice(list.length - 1, 1, candle)
	else if (candle.time > last.time) {
		list.push(candle)
		if (list.length > 120) list.shift()
	}
}

async function loadKlines() {
	unsubKline?.()
	klines.value = []
	klines.value = await getKlines(symbol.value, interval.value)
	unsubKline = socket.subscribe(`kline:${symbol.value}:${interval.value}`, onKline)
}

function changeInterval(value: KlineInterval) {
	if (value === interval.value) return
	interval.value = value
	loadKlines()
}

onLoad((options) => {
	symbol.value = (options?.symbol || 'BTC').toUpperCase()
	uni.setNavigationBarTitle({ title: `${symbol.value}/USDT` })
	if (!market.list.length) market.refresh()
	// 详情页不是 tab 页，返回时会被销毁，所以在 onLoad 订阅、onUnload 取消即可
	unsubTicker = market.subscribe()
	loadKlines()
})

onUnload(() => {
	unsubTicker?.()
	unsubKline?.()
})

// OTC 只支持 USDT / BTC / ETH，其他币种引导用 USDT 购买
function goTrade(side: 'buy' | 'sell') {
	const coin = ['USDT', 'BTC', 'ETH'].includes(symbol.value) ? symbol.value : 'USDT'
	if (coin !== symbol.value) uni.showToast({ title: `OTC 暂不支持 ${symbol.value}，已切换到 USDT`, icon: 'none' })
	otc.preset(side, coin)
	uni.switchTab({ url: '/pages/otc/otc' })
}
</script>

<style scoped>
.page {
  padding-bottom: calc(140rpx + env(safe-area-inset-bottom));
}

.summary {
  display: flex;
  justify-content: space-between;
  padding: 28rpx 32rpx;
  background-color: #fff;
}

.left {
  display: flex;
  flex-direction: column;
}

.price {
  font-size: 52rpx;
  font-weight: 600;
}

.change {
  margin-top: 8rpx;
  font-size: 26rpx;
}

.stats {
  display: flex;
  flex-direction: column;
  justify-content: space-between;
}

.stat {
  display: flex;
  justify-content: space-between;
  min-width: 300rpx;
  font-size: 22rpx;
}
.stat .muted {
  margin-right: 16rpx;
}

.chart-card {
  margin-top: 16rpx;
  padding: 16rpx 24rpx 24rpx;
  background-color: #fff;
}

.intervals {
  display: flex;
  padding-bottom: 12rpx;
  border-bottom: 1rpx solid var(--otc-border);
}

.interval {
  margin-right: 36rpx;
  padding: 6rpx 0;
  font-size: 26rpx;
  color: var(--otc-muted);
}
.interval.active {
  color: var(--otc-text);
  font-weight: 600;
  border-bottom: 4rpx solid var(--otc-primary);
}

.legend {
  display: flex;
  gap: 20rpx;
  padding: 12rpx 0;
  font-size: 22rpx;
}

.ma5 {
  color: #f0b90b;
}

.ma10 {
  color: #8e5cf6;
}

.chart-loading {
  height: 320px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.tip {
  padding: 20rpx 32rpx;
  font-size: 22rpx;
}

.actions {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  gap: 24rpx;
  padding: 20rpx 32rpx calc(20rpx + env(safe-area-inset-bottom));
  background-color: #fff;
  box-shadow: 0 -2rpx 12rpx rgba(0, 0, 0, 0.04);
}

.action {
  flex: 1;
  color: #fff;
  font-size: 30rpx;
  font-weight: 600;
  border: none;
}
</style>
