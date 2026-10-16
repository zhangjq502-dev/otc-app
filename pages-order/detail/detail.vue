<template>
	<view v-if="order" class="page">
		<view class="status-card" :class="order.status">
			<text class="status-title">{{ statusInfo.title }}</text>
			<text class="status-desc">{{ statusInfo.desc }}</text>
			<text v-if="order.status === 'pending'" class="countdown num">{{ formatCountdown(remain) }}</text>
		</view>

		<view class="card steps">
			<view v-for="(s, i) in steps" :key="s" class="step" :class="{ done: i <= stepIndex }">
				<view class="step-dot">{{ i + 1 }}</view>
				<text class="step-text">{{ s }}</text>
			</view>
		</view>

		<view class="card">
			<view class="row">
				<text class="muted">{{ order.side === 'buy' ? '购买' : '出售' }}</text>
				<text class="num strong">{{ formatAmount(order.amount, order.coin) }} {{ order.coin }}</text>
			</view>
			<view class="row">
				<text class="muted">单价</text>
				<text class="num">¥{{ order.price.toFixed(2) }}</text>
			</view>
			<view class="row">
				<text class="muted">总额</text>
				<text class="num total">¥{{ order.total.toFixed(2) }}</text>
			</view>
			<view class="row">
				<text class="muted">交易对象</text>
				<text>{{ order.merchant.name }}</text>
			</view>
			<view class="row">
				<text class="muted">订单号</text>
				<text class="num copy" @click="copy(order.id)">{{ order.id }} ⧉</text>
			</view>
			<view class="row">
				<text class="muted">下单时间</text>
				<text class="num">{{ formatTime(order.createdAt) }}</text>
			</view>
			<view v-if="order.cancelReason" class="row">
				<text class="muted">取消原因</text>
				<text>{{ order.cancelReason }}</text>
			</view>
		</view>

		<view v-if="order.status !== 'cancelled'" class="card">
			<text class="section-title">{{ order.side === 'buy' ? '对方收款信息' : '我的收款信息' }}</text>
			<view class="row">
				<text class="muted">收款方式</text>
				<text>{{ order.payMethodName }}</text>
			</view>
			<view class="row">
				<text class="muted">收款人</text>
				<text>{{ order.payee.name }}</text>
			</view>
			<view class="row">
				<text class="muted">账号</text>
				<text class="copy" @click="copy(order.payee.account)">{{ order.payee.account }} ⧉</text>
			</view>
			<text v-if="order.side === 'buy' && order.status === 'pending'" class="warn">
				请使用本人实名账户付款，付款后务必点击「我已付款」
			</text>
		</view>

		<view v-if="actions.length" class="footer">
			<button
				v-for="a in actions"
				:key="a.key"
				class="footer-btn"
				:class="a.primary ? 'btn-primary' : 'btn-ghost'"
				:loading="busy === a.key"
				:disabled="Boolean(busy)"
				@click="a.run"
			>
				{{ a.label }}
			</button>
		</view>
	</view>
	<view v-else class="loading muted">加载中…</view>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { onLoad, onShow, onUnload } from '@dcloudio/uni-app'
import { cancelOrder, getOrder, payOrder, releaseOrder } from '@/api/otc'
import { socket } from '@/utils/socket'
import { formatAmount, formatCountdown, formatTime } from '@/utils/format'
import type { Order } from '@/types'

const order = ref<Order | null>(null)
const now = ref(Date.now())
const busy = ref('')
let orderId = ''
let timer: ReturnType<typeof setInterval> | null = null
let unsubscribe: (() => void) | null = null

const remain = computed(() => (order.value ? order.value.expireAt - now.value : 0))

const steps = computed(() =>
	order.value?.side === 'sell' ? ['等待对方付款', '确认收款并放币', '交易完成'] : ['下单并付款', '等待商家放币', '交易完成']
)

const stepIndex = computed(() => {
	const s = order.value?.status
	return s === 'completed' ? 2 : s === 'paid' ? 1 : s === 'pending' ? 0 : -1
})

const statusInfo = computed(() => {
	const o = order.value
	if (!o) return { title: '', desc: '' }
	const map: Record<string, { title: string; desc: string }> = {
		'buy-pending': { title: '待付款', desc: '请在倒计时结束前完成付款，超时订单将自动取消' },
		'buy-paid': { title: '等待放币', desc: '商家确认收款后会放币，通常需要几分钟' },
		'sell-pending': { title: '等待对方付款', desc: '买家付款后，请确认收到款项再放币' },
		'sell-paid': { title: '对方已付款', desc: '请登录收款账户确认到账后，再点击放币' },
		'buy-completed': { title: '交易完成', desc: `${formatAmount(o.amount, o.coin)} ${o.coin} 已到账` },
		'sell-completed': { title: '交易完成', desc: '币已放给买家' }
	}
	if (o.status === 'cancelled') return { title: '已取消', desc: o.cancelReason || '订单已取消' }
	return map[`${o.side}-${o.status}`]
})

interface Action {
	key: string
	label: string
	primary?: boolean
	run: () => void
}

const actions = computed<Action[]>(() => {
	const o = order.value
	if (!o) return []
	if (o.side === 'buy' && o.status === 'pending') {
		return [
			{ key: 'cancel', label: '取消订单', run: onCancel },
			{ key: 'pay', label: '我已付款', primary: true, run: onPay }
		]
	}
	if (o.side === 'sell' && o.status === 'paid') {
		return [{ key: 'release', label: '确认收款并放币', primary: true, run: onRelease }]
	}
	if (o.status === 'completed' || o.status === 'cancelled') {
		return [{ key: 'again', label: '返回 OTC', primary: true, run: () => uni.switchTab({ url: '/pages/otc/otc' }) }]
	}
	return []
})

function confirm(content: string) {
	return new Promise<boolean>((resolve) => {
		uni.showModal({ title: '提示', content, success: (r) => resolve(r.confirm) })
	})
}

async function run(key: string, fn: () => Promise<Order>) {
	busy.value = key
	try {
		order.value = await fn()
	} finally {
		busy.value = ''
	}
}

async function onPay() {
	if (await confirm('请确认你已向对方账户转账，恶意点击将被冻结账户')) run('pay', () => payOrder(orderId))
}

async function onCancel() {
	if (await confirm('确定取消订单吗？如已付款请勿取消')) run('cancel', () => cancelOrder(orderId))
}

async function onRelease() {
	if (await confirm('请确认已在收款账户中收到全额款项，放币后无法撤回')) run('release', () => releaseOrder(orderId))
}

function copy(text: string) {
	uni.setClipboardData({ data: text })
}

async function load() {
	order.value = await getOrder(orderId)
}

onLoad((options) => {
	orderId = String(options?.id)
	load()
	// 订单状态由后端推送：商家放币、对方付款、超时取消都会实时更新
	unsubscribe = socket.subscribe('orders', (data: Order) => {
		if (data.id !== orderId) return
		const prev = order.value?.status
		order.value = data
		if (prev && prev !== data.status) uni.showToast({ title: statusInfo.value.title, icon: 'none' })
	})
	timer = setInterval(() => (now.value = Date.now()), 1000)
})

// 从后台切回来时以接口数据为准，防止期间推送丢失
onShow(() => {
	if (order.value) load()
})

onUnload(() => {
	unsubscribe?.()
	if (timer) clearInterval(timer)
})
</script>

<style scoped>
.page {
  padding-bottom: calc(160rpx + env(safe-area-inset-bottom));
}

.status-card {
  display: flex;
  flex-direction: column;
  padding: 40rpx 32rpx;
  color: var(--otc-text);
  background-color: #fff8e1;
}
.status-card.completed {
  background-color: #e7f9f1;
}
.status-card.cancelled {
  background-color: #f0f1f3;
}

.status-title {
  font-size: 40rpx;
  font-weight: 600;
}

.status-desc {
  margin-top: 8rpx;
  font-size: 24rpx;
  color: var(--otc-muted);
}

.countdown {
  margin-top: 16rpx;
  font-size: 48rpx;
  font-weight: 600;
  color: #c99400;
}

.steps {
  display: flex;
  justify-content: space-between;
}

.step {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  color: var(--otc-muted);
}
.step.done {
  color: var(--otc-text);
}
.step.done .step-dot {
  background-color: var(--otc-primary);
  color: #fff;
}

.step-dot {
  width: 44rpx;
  height: 44rpx;
  border-radius: 50%;
  background-color: var(--otc-bg);
  font-size: 22rpx;
  line-height: 44rpx;
  text-align: center;
}

.step-text {
  margin-top: 8rpx;
  font-size: 22rpx;
}

.row {
  display: flex;
  justify-content: space-between;
  padding: 14rpx 0;
  font-size: 26rpx;
}

.strong {
  font-weight: 600;
}

.total {
  font-size: 32rpx;
  font-weight: 600;
}

.copy {
  color: #c99400;
}

.section-title {
  display: block;
  margin-bottom: 8rpx;
  font-weight: 600;
}

.warn {
  display: block;
  margin-top: 12rpx;
  padding: 16rpx;
  font-size: 22rpx;
  color: #c99400;
  background-color: #fff8e1;
  border-radius: 8rpx;
}

.footer {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  gap: 24rpx;
  padding: 20rpx 32rpx calc(20rpx + env(safe-area-inset-bottom));
  background-color: #fff;
}

.footer-btn {
  flex: 1;
  font-size: 28rpx;
}

.btn-ghost {
  background-color: var(--otc-bg);
  color: var(--otc-text);
  border: none;
}

.loading {
  padding: 120rpx 0;
  text-align: center;
}
</style>
