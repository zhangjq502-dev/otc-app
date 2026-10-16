<template>
	<view class="page">
		<view class="toolbar">
			<view class="search">
				<input v-model="keyword" class="search-input" placeholder="搜索币种" confirm-type="search" />
			</view>
			<view class="status">
				<view class="dot" :class="socketState.status" />
				<text class="muted">{{ statusText }}</text>
			</view>
		</view>

		<view class="sort-bar">
			<text
				v-for="opt in sortOptions"
				:key="opt.value"
				class="sort-item"
				:class="{ active: sortBy === opt.value }"
				@click="sortBy = opt.value"
			>
				{{ opt.label }}
			</text>
		</view>

		<view class="list">
			<view class="header">
				<text class="col-name">币种 / 成交额</text>
				<text class="col-price">最新价</text>
				<text class="col-change">涨跌幅</text>
			</view>
			<view
				v-for="item in displayList"
				:key="item.symbol"
				class="row"
				@click="goDetail(item.symbol)"
			>
				<view class="col-name">
					<view>
						<text class="symbol">{{ item.symbol }}</text>
						<text class="quote">/{{ item.quote }}</text>
					</view>
					<text class="turnover muted">{{ formatCompact(item.turnover) }}</text>
				</view>
				<text class="col-price num" :class="flashClass(item.symbol)">
					{{ formatPrice(item.price, item.digits > 2 ? 4 : 2) }}
				</text>
				<view class="col-change">
					<text class="badge num" :style="{ backgroundColor: settings.trendColor(item.change) }">
						{{ formatPercent(item.change) }}
					</text>
				</view>
			</view>
			<view v-if="!displayList.length" class="empty muted">
				{{ loading ? '加载中…' : '没有找到相关币种' }}
			</view>
		</view>
	</view>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { onHide, onPullDownRefresh, onShow, onUnload } from '@dcloudio/uni-app'
import { useMarketStore } from '@/stores/market'
import { useSettingsStore } from '@/stores/settings'
import { socketState } from '@/utils/socket'
import { formatCompact, formatPercent, formatPrice } from '@/utils/format'
import { tracker } from '@/utils/tracker'

type SortBy = 'default' | 'change' | 'turnover'

const market = useMarketStore()
const settings = useSettingsStore()
const keyword = ref('')
const sortBy = ref<SortBy>('default')
const loading = ref(true)
const sortOptions: { label: string; value: SortBy }[] = [
	{ label: '默认', value: 'default' },
	{ label: '涨幅榜', value: 'change' },
	{ label: '成交额', value: 'turnover' }
]

const displayList = computed(() => {
	const kw = keyword.value.trim().toUpperCase()
	const list = market.list.filter((t) => !kw || t.symbol.includes(kw))
	if (sortBy.value === 'change') return [...list].sort((a, b) => b.change - a.change)
	if (sortBy.value === 'turnover') return [...list].sort((a, b) => b.turnover - a.turnover)
	return list
})

const statusText = computed(() => {
	if (socketState.status === 'open') return '实时'
	if (socketState.status === 'connecting') return '连接中'
	return socketState.retry ? `重连中(${socketState.retry})` : '未连接'
})

// 价格变化时短暂闪烁颜色
const flashClass = (symbol: string) => {
	const dir = market.flash[symbol]
	return dir ? `flash-${dir}-${settings.colorMode}` : ''
}

let unsubscribe: (() => void) | null = null

async function refresh() {
	try {
		await market.refresh()
	} finally {
		loading.value = false
	}
}

// tab 页不会被销毁：onShow 订阅、onHide 取消，切走后不再接收推送
onShow(() => {
	if (!market.list.length) refresh()
	unsubscribe = market.subscribe()
})

onHide(() => {
	unsubscribe?.()
	unsubscribe = null
})

onUnload(() => unsubscribe?.())

onPullDownRefresh(async () => {
	await refresh().catch(() => {})
	uni.stopPullDownRefresh()
})

function goDetail(symbol: string) {
	tracker.click('market_row', { symbol })
	uni.navigateTo({ url: `/pages/detail/detail?symbol=${symbol}` })
}
</script>

<style scoped>
.toolbar {
  display: flex;
  align-items: center;
  padding: 20rpx 32rpx;
  background-color: #fff;
}

.search {
  flex: 1;
  height: 64rpx;
  padding: 0 24rpx;
  background-color: var(--otc-bg);
  border-radius: 32rpx;
  display: flex;
  align-items: center;
}

.search-input {
  flex: 1;
  font-size: 26rpx;
}

.status {
  display: flex;
  align-items: center;
  margin-left: 24rpx;
  font-size: 22rpx;
}

.dot {
  width: 12rpx;
  height: 12rpx;
  margin-right: 8rpx;
  border-radius: 50%;
  background-color: #c4c7cc;
}
.dot.open {
  background-color: #0ecb81;
}
.dot.connecting {
  background-color: var(--otc-primary);
}

.sort-bar {
  display: flex;
  padding: 8rpx 32rpx 20rpx;
  background-color: #fff;
}

.sort-item {
  margin-right: 40rpx;
  font-size: 26rpx;
  color: var(--otc-muted);
}
.sort-item.active {
  color: var(--otc-text);
  font-weight: 600;
}

.list {
  background-color: #fff;
}

.header,
.row {
  display: flex;
  align-items: center;
  padding: 24rpx 32rpx;
}

.header {
  padding-top: 8rpx;
  padding-bottom: 8rpx;
  font-size: 22rpx;
  color: var(--otc-muted);
}

.row {
  border-bottom: 1rpx solid var(--otc-border);
}
.row:active {
  background-color: #fafafa;
}

.col-name {
  flex: 2;
  display: flex;
  flex-direction: column;
}

.col-price {
  flex: 2;
  text-align: right;
  font-size: 30rpx;
  font-weight: 500;
  transition: color 0.3s;
}

.header .col-price {
  font-size: 22rpx;
  font-weight: normal;
}

.col-change {
  flex: 1.6;
  display: flex;
  justify-content: flex-end;
}

.symbol {
  font-size: 32rpx;
  font-weight: 600;
}

.quote {
  font-size: 22rpx;
  color: var(--otc-muted);
}

.turnover {
  margin-top: 4rpx;
  font-size: 22rpx;
}

.badge {
  min-width: 150rpx;
  padding: 12rpx 0;
  border-radius: 8rpx;
  color: #fff;
  text-align: center;
  font-size: 26rpx;
  font-weight: 500;
}

.flash-up-green-up,
.flash-down-red-up {
  color: #0ecb81;
}

.flash-down-green-up,
.flash-up-red-up {
  color: #f6465d;
}

.empty {
  padding: 80rpx 0;
  text-align: center;
}
</style>
