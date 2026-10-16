<template>
	<view class="page">
		<view class="tabs">
			<text
				v-for="t in tabs"
				:key="t.value"
				class="tab"
				:class="{ active: status === t.value }"
				@click="status = t.value"
			>
				{{ t.label }}
			</text>
		</view>

		<view v-for="o in orders" :key="o.id" class="card order" @click="goDetail(o.id)">
			<view class="order-head">
				<text class="side" :style="{ color: o.side === 'buy' ? settings.upColor : settings.downColor }">
					{{ o.side === 'buy' ? '购买' : '出售' }} {{ o.coin }}
				</text>
				<text class="status" :class="o.status">{{ statusText[o.status] }}</text>
			</view>
			<view class="order-row muted">
				<text>数量</text>
				<text class="num">{{ formatAmount(o.amount, o.coin) }} {{ o.coin }}</text>
			</view>
			<view class="order-row muted">
				<text>总额</text>
				<text class="num total">¥{{ o.total.toFixed(2) }}</text>
			</view>
			<view class="order-row muted">
				<text>{{ o.merchant.name }}</text>
				<text class="num">{{ formatTime(o.createdAt) }}</text>
			</view>
		</view>

		<view v-if="!orders.length" class="empty muted">{{ loading ? '加载中…' : '暂无订单' }}</view>
	</view>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { onPullDownRefresh, onShow } from '@dcloudio/uni-app'
import { getOrders } from '@/api/otc'
import { useSettingsStore } from '@/stores/settings'
import { formatAmount, formatTime } from '@/utils/format'
import type { Order, OrderStatus } from '@/types'

const settings = useSettingsStore()
const tabs: { label: string; value: OrderStatus | '' }[] = [
	{ label: '全部', value: '' },
	{ label: '待付款', value: 'pending' },
	{ label: '待放币', value: 'paid' },
	{ label: '已完成', value: 'completed' },
	{ label: '已取消', value: 'cancelled' }
]
const statusText: Record<OrderStatus, string> = {
	pending: '待付款',
	paid: '待放币',
	completed: '已完成',
	cancelled: '已取消'
}

const status = ref<OrderStatus | ''>('')
const orders = ref<Order[]>([])
const loading = ref(false)

async function load() {
	loading.value = true
	try {
		orders.value = await getOrders(status.value || undefined)
	} finally {
		loading.value = false
	}
}

watch(status, load)
// 从订单详情返回时状态可能已变化，onShow 时刷新
onShow(load)

onPullDownRefresh(async () => {
	await load().catch(() => {})
	uni.stopPullDownRefresh()
})

function goDetail(id: string) {
	uni.navigateTo({ url: `/pages-order/detail/detail?id=${id}` })
}
</script>

<style scoped>
.tabs {
  display: flex;
  justify-content: space-around;
  padding: 20rpx 0;
  background-color: #fff;
}

.tab {
  font-size: 26rpx;
  color: var(--otc-muted);
}
.tab.active {
  color: var(--otc-text);
  font-weight: 600;
}

.order {
  margin-bottom: 0;
}

.order-head {
  display: flex;
  justify-content: space-between;
  margin-bottom: 12rpx;
}

.side {
  font-size: 30rpx;
  font-weight: 600;
}

.status {
  font-size: 24rpx;
}
.status.pending, .status.paid {
  color: #c99400;
}
.status.completed {
  color: #0ecb81;
}
.status.cancelled {
  color: var(--otc-muted);
}

.order-row {
  display: flex;
  justify-content: space-between;
  padding: 6rpx 0;
  font-size: 24rpx;
}

.total {
  color: var(--otc-text);
  font-weight: 600;
}

.empty {
  padding: 120rpx 0;
  text-align: center;
}
</style>
