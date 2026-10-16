<template>
	<view class="page">
		<view class="top">
			<view class="side-switch">
				<text class="side" :class="{ active: otc.side === 'buy' }" @click="otc.side = 'buy'">我要买</text>
				<text class="side" :class="{ active: otc.side === 'sell' }" @click="otc.side = 'sell'">我要卖</text>
			</view>
			<text class="orders-link" @click="goOrders">订单 ›</text>
		</view>

		<view class="filters">
			<view class="coins">
				<text
					v-for="c in coins"
					:key="c"
					class="coin"
					:class="{ active: otc.coin === c }"
					@click="otc.coin = c"
				>
					{{ c }}
				</text>
			</view>
			<picker :range="payOptions" range-key="label" :value="payIndex" @change="onPayChange">
				<text class="pay-filter">{{ payOptions[payIndex].label }} ▾</text>
			</picker>
		</view>

		<view v-for="ad in ads" :key="ad.id" class="ad card">
			<view class="merchant">
				<view class="avatar">{{ ad.merchant.name.slice(0, 1) }}</view>
				<text class="merchant-name">{{ ad.merchant.name }}</text>
				<view v-if="ad.merchant.online" class="online" />
				<text class="merchant-stat muted">{{ ad.merchant.orders }} 单 · {{ ad.merchant.rate }}%</text>
			</view>
			<view class="ad-body">
				<view class="ad-info">
					<text class="muted label">单价</text>
					<text class="ad-price num">¥{{ ad.price.toFixed(2) }}</text>
					<text class="muted line">数量 {{ formatAmount(ad.available, ad.coin) }} {{ ad.coin }}</text>
					<text class="muted line">限额 ¥{{ ad.minAmount }} - ¥{{ ad.maxAmount.toLocaleString() }}</text>
					<view class="methods">
						<text v-for="m in ad.payMethods" :key="m" class="method" :class="m">{{ payNames[m] }}</text>
					</view>
				</view>
				<button
					class="trade-btn"
					:style="{ backgroundColor: otc.side === 'buy' ? settings.upColor : settings.downColor }"
					@click="goCreate(ad)"
				>
					{{ otc.side === 'buy' ? '购买' : '出售' }}
				</button>
			</view>
		</view>

		<view v-if="!ads.length" class="empty muted">{{ loading ? '加载中…' : '暂无广告' }}</view>
		<view class="risk muted">请勿在平台外交易，付款时不要备注任何与数字货币相关的信息</view>
	</view>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { onPullDownRefresh, onShow } from '@dcloudio/uni-app'
import { getAds } from '@/api/otc'
import { useOtcStore } from '@/stores/otc'
import { useSettingsStore } from '@/stores/settings'
import { useUserStore } from '@/stores/user'
import { formatAmount } from '@/utils/format'
import { tracker } from '@/utils/tracker'
import type { Ad, PayMethod } from '@/types'

const otc = useOtcStore()
const settings = useSettingsStore()
const userStore = useUserStore()

const coins = ['USDT', 'BTC', 'ETH']
const payNames: Record<PayMethod, string> = { bank: '银行卡', alipay: '支付宝', wechat: '微信' }
const payOptions: { label: string; value: PayMethod | '' }[] = [
	{ label: '全部支付方式', value: '' },
	{ label: '银行卡', value: 'bank' },
	{ label: '支付宝', value: 'alipay' },
	{ label: '微信', value: 'wechat' }
]
const payIndex = ref(0)
const ads = ref<Ad[]>([])
const loading = ref(false)
const payMethod = computed(() => payOptions[payIndex.value].value)

// 连续切换筛选时，只保留最后一次请求的结果，避免旧请求后返回覆盖新数据
let requestId = 0
async function loadAds() {
	const id = ++requestId
	loading.value = true
	try {
		const list = await getAds({ side: otc.side, coin: otc.coin, payMethod: payMethod.value })
		if (id === requestId) ads.value = list
	} finally {
		if (id === requestId) loading.value = false
	}
}

function onPayChange(e: { detail: { value: number | string } }) {
	payIndex.value = Number(e.detail.value)
}

watch(() => [otc.side, otc.coin, payIndex.value], () => loadAds())

// 每次显示都刷新：从详情页 switchTab 过来时筛选条件可能已经变了
onShow(() => loadAds())

onPullDownRefresh(async () => {
	await loadAds().catch(() => {})
	uni.stopPullDownRefresh()
})

function requireLogin() {
	if (userStore.isLogin) return true
	uni.navigateTo({ url: '/pages/login/login' })
	return false
}

function goCreate(ad: Ad) {
	tracker.click('otc_trade', { side: ad.side, coin: ad.coin, adId: ad.id })
	if (!requireLogin()) return
	uni.navigateTo({ url: `/pages-order/create/create?adId=${ad.id}` })
}

function goOrders() {
	if (!requireLogin()) return
	uni.navigateTo({ url: '/pages-order/list/list' })
}
</script>

<style scoped>
.page {
  padding-bottom: 24rpx;
}

.top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 24rpx 32rpx 8rpx;
  background-color: #fff;
}

.side-switch {
  display: flex;
  padding: 6rpx;
  background-color: var(--otc-bg);
  border-radius: 12rpx;
}

.side {
  padding: 12rpx 36rpx;
  font-size: 28rpx;
  color: var(--otc-muted);
  border-radius: 8rpx;
}
.side.active {
  color: var(--otc-text);
  font-weight: 600;
  background-color: #fff;
  box-shadow: 0 2rpx 6rpx rgba(0, 0, 0, 0.06);
}

.orders-link {
  font-size: 26rpx;
  color: var(--otc-muted);
}

.filters {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 20rpx 32rpx;
  background-color: #fff;
  border-bottom: 1rpx solid var(--otc-border);
}

.coins {
  display: flex;
}

.coin {
  margin-right: 36rpx;
  font-size: 28rpx;
  color: var(--otc-muted);
}
.coin.active {
  color: var(--otc-text);
  font-weight: 600;
}

.pay-filter {
  font-size: 24rpx;
  color: var(--otc-muted);
}

.ad {
  margin-bottom: 0;
}

.merchant {
  display: flex;
  align-items: center;
}

.avatar {
  width: 44rpx;
  height: 44rpx;
  margin-right: 12rpx;
  border-radius: 50%;
  background-color: var(--otc-primary);
  color: #fff;
  font-size: 22rpx;
  line-height: 44rpx;
  text-align: center;
}

.merchant-name {
  font-size: 28rpx;
  font-weight: 600;
}

.online {
  width: 12rpx;
  height: 12rpx;
  margin-left: 8rpx;
  border-radius: 50%;
  background-color: #0ecb81;
}

.merchant-stat {
  margin-left: auto;
  font-size: 22rpx;
}

.ad-body {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  margin-top: 16rpx;
}

.ad-info {
  display: flex;
  flex-direction: column;
}

.label {
  font-size: 22rpx;
}

.ad-price {
  margin: 4rpx 0 8rpx;
  font-size: 40rpx;
  font-weight: 600;
}

.line {
  font-size: 24rpx;
  line-height: 1.7;
}

.methods {
  display: flex;
  gap: 12rpx;
  margin-top: 8rpx;
}

.method {
  padding: 2rpx 12rpx;
  font-size: 20rpx;
  border-left: 4rpx solid;
}
.method.bank {
  border-color: #f0b90b;
}
.method.alipay {
  border-color: #1677ff;
}
.method.wechat {
  border-color: #07c160;
}

.trade-btn {
  margin: 0;
  width: 150rpx;
  height: 64rpx;
  line-height: 64rpx;
  font-size: 26rpx;
  color: #fff;
  border: none;
}

.empty {
  padding: 80rpx 0;
  text-align: center;
}

.risk {
  padding: 24rpx 32rpx;
  font-size: 22rpx;
  text-align: center;
}
</style>
