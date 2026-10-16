<template>
	<view v-if="ad" class="page">
		<view class="card head">
			<text class="title">{{ ad.side === 'buy' ? '购买' : '出售' }} {{ ad.coin }}</text>
			<text class="muted">单价 <text class="num strong">¥{{ ad.price.toFixed(2) }}</text></text>
			<text class="muted small">商家：{{ ad.merchant.name }} · 成交 {{ ad.merchant.orders }} 单</text>
		</view>

		<view class="card">
			<view class="mode-tabs">
				<text class="mode" :class="{ active: mode === 'fiat' }" @click="switchMode('fiat')">按金额</text>
				<text class="mode" :class="{ active: mode === 'coin' }" @click="switchMode('coin')">按数量</text>
			</view>
			<view class="input-row">
				<input
					v-model="inputValue"
					class="amount-input num"
					type="digit"
					:placeholder="mode === 'fiat' ? `¥${ad.minAmount} - ¥${ad.maxAmount}` : '请输入数量'"
				/>
				<text class="unit">{{ mode === 'fiat' ? 'CNY' : ad.coin }}</text>
				<text class="all" @click="fillMax">全部</text>
			</view>
			<view class="calc muted">
				<text v-if="mode === 'fiat'">≈ {{ formatAmount(coinAmount, ad.coin) }} {{ ad.coin }}</text>
				<text v-else>≈ ¥{{ fiatAmount.toFixed(2) }}</text>
			</view>
			<text v-if="error" class="error">{{ error }}</text>
			<text v-if="ad.side === 'sell'" class="muted small">
				可用 {{ formatAmount(available, ad.coin) }} {{ ad.coin }}
			</text>
		</view>

		<view class="card">
			<text class="section-title">支付方式</text>
			<view
				v-for="m in ad.payMethods"
				:key="m"
				class="pay-item"
				:class="{ active: payMethod === m }"
				@click="payMethod = m"
			>
				<text>{{ payNames[m] }}</text>
				<view class="radio" :class="{ checked: payMethod === m }" />
			</view>
		</view>

		<view class="card summary">
			<text class="muted">实付金额</text>
			<text class="total num">¥{{ fiatAmount.toFixed(2) }}</text>
		</view>

		<view class="footer">
			<button class="btn-primary submit" :disabled="!canSubmit || submitting" :loading="submitting" @click="submit">
				{{ ad.side === 'buy' ? '下单购买' : '下单出售' }}
			</button>
		</view>
	</view>
	<view v-else class="loading muted">加载中…</view>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import { createOrder, getAd } from '@/api/otc'
import { useUserStore } from '@/stores/user'
import { formatAmount } from '@/utils/format'
import type { Ad, PayMethod } from '@/types'

const userStore = useUserStore()
const payNames: Record<PayMethod, string> = { bank: '银行卡', alipay: '支付宝', wechat: '微信支付' }

const ad = ref<Ad | null>(null)
const mode = ref<'fiat' | 'coin'>('fiat')
const inputValue = ref('')
const payMethod = ref<PayMethod>('bank')
const submitting = ref(false)

const coinDigits = computed(() => (ad.value?.coin === 'USDT' ? 2 : 6))
const available = computed(() => (ad.value ? userStore.user?.assets[ad.value.coin]?.available ?? 0 : 0))

// 两种输入方式互相换算：按金额时算数量，按数量时算金额
const fiatAmount = computed(() => {
	const v = Number(inputValue.value) || 0
	if (!ad.value) return 0
	return mode.value === 'fiat' ? v : v * ad.value.price
})
const coinAmount = computed(() => {
	const v = Number(inputValue.value) || 0
	if (!ad.value) return 0
	return mode.value === 'coin' ? v : v / ad.value.price
})

const error = computed(() => {
	if (!ad.value || !inputValue.value) return ''
	if (fiatAmount.value < ad.value.minAmount) return `最低 ¥${ad.value.minAmount}`
	if (fiatAmount.value > ad.value.maxAmount) return `最高 ¥${ad.value.maxAmount}`
	if (coinAmount.value > ad.value.available) return '超过商家可交易数量'
	if (ad.value.side === 'sell' && coinAmount.value > available.value) return `${ad.value.coin} 余额不足`
	return ''
})

const canSubmit = computed(() => Boolean(inputValue.value) && !error.value)

function switchMode(next: 'fiat' | 'coin') {
	if (next === mode.value || !ad.value) return
	// 切换时把当前值换算过去，用户不用重新输入
	if (inputValue.value) {
		inputValue.value =
			next === 'coin' ? coinAmount.value.toFixed(coinDigits.value) : fiatAmount.value.toFixed(2)
	}
	mode.value = next
}

// 「全部」：在商家限额、商家库存、（卖单时）自己余额之间取最小值
function fillMax() {
	if (!ad.value) return
	let maxFiat = Math.min(ad.value.maxAmount, ad.value.available * ad.value.price)
	if (ad.value.side === 'sell') maxFiat = Math.min(maxFiat, available.value * ad.value.price)
	maxFiat = Math.floor(maxFiat * 100) / 100
	inputValue.value = mode.value === 'fiat' ? String(maxFiat) : (maxFiat / ad.value.price).toFixed(coinDigits.value)
}

async function submit() {
	if (!ad.value || !canSubmit.value) return
	submitting.value = true
	try {
		const order = await createOrder({
			adId: ad.value.id,
			fiatAmount: Number(fiatAmount.value.toFixed(2)),
			payMethod: payMethod.value
		})
		// redirectTo：关闭下单页再打开订单页，返回时不会回到已提交的下单页
		uni.redirectTo({ url: `/pages-order/detail/detail?id=${order.id}` })
	} finally {
		submitting.value = false
	}
}

onLoad(async (options) => {
	ad.value = await getAd(String(options?.adId))
	payMethod.value = ad.value.payMethods[0]
	uni.setNavigationBarTitle({ title: `${ad.value.side === 'buy' ? '购买' : '出售'} ${ad.value.coin}` })
	if (ad.value.side === 'sell') userStore.fetchMe().catch(() => {})
})
</script>

<style scoped>
.page {
  padding-bottom: calc(160rpx + env(safe-area-inset-bottom));
}

.head {
  display: flex;
  flex-direction: column;
  gap: 8rpx;
}

.title {
  font-size: 36rpx;
  font-weight: 600;
}

.strong {
  color: var(--otc-text);
  font-weight: 600;
}

.small {
  font-size: 22rpx;
}

.mode-tabs {
  display: flex;
  gap: 40rpx;
  margin-bottom: 20rpx;
}

.mode {
  font-size: 28rpx;
  color: var(--otc-muted);
}
.mode.active {
  color: var(--otc-text);
  font-weight: 600;
}

.input-row {
  display: flex;
  align-items: center;
  padding: 20rpx 24rpx;
  background-color: var(--otc-bg);
  border-radius: 12rpx;
}

.amount-input {
  flex: 1;
  font-size: 34rpx;
}

.unit {
  margin: 0 20rpx;
  font-size: 26rpx;
  color: var(--otc-muted);
}

.all {
  font-size: 26rpx;
  color: #c99400;
}

.calc {
  margin-top: 16rpx;
  font-size: 24rpx;
}

.error {
  display: block;
  margin-top: 8rpx;
  font-size: 24rpx;
  color: #f6465d;
}

.section-title {
  display: block;
  margin-bottom: 12rpx;
  font-weight: 600;
}

.pay-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 24rpx 0;
  border-bottom: 1rpx solid var(--otc-border);
}
.pay-item:last-child {
  border-bottom: none;
}

.radio {
  width: 32rpx;
  height: 32rpx;
  border: 2rpx solid #c4c7cc;
  border-radius: 50%;
  box-sizing: border-box;
}
.radio.checked {
  border: 10rpx solid var(--otc-primary);
}

.summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.total {
  font-size: 40rpx;
  font-weight: 600;
}

.footer {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  padding: 20rpx 32rpx calc(20rpx + env(safe-area-inset-bottom));
  background-color: #fff;
}

.submit {
  width: 100%;
}

.loading {
  padding: 120rpx 0;
  text-align: center;
}
</style>
