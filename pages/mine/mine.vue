<template>
	<view class="page">
		<view v-if="userStore.isLogin && user" class="profile">
			<view class="avatar">{{ user.nickname.slice(0, 1).toUpperCase() }}</view>
			<view class="info">
				<text class="name">{{ user.nickname }}</text>
				<text class="uid muted">UID {{ user.id.slice(0, 8) }}</text>
			</view>
		</view>
		<view v-else class="profile" @click="goLogin">
			<view class="avatar empty">?</view>
			<view class="info">
				<text class="name">登录 / 注册</text>
				<text class="uid muted">登录后可进行 OTC 交易</text>
			</view>
		</view>

		<view v-if="user" class="card assets">
			<text class="muted small">总资产估值（USDT）</text>
			<text class="total num">{{ totalValue.toFixed(2) }}</text>
			<view v-for="row in assetRows" :key="row.coin" class="asset-row">
				<text class="coin">{{ row.coin }}</text>
				<view class="asset-nums">
					<text class="num">{{ formatAmount(row.available, row.coin) }}</text>
					<text v-if="row.frozen" class="muted small num">冻结 {{ formatAmount(row.frozen, row.coin) }}</text>
				</view>
			</view>
		</view>

		<view class="card menu">
			<view class="menu-item" @click="goOrders">
				<text>我的订单</text>
				<text class="muted">›</text>
			</view>
			<view class="menu-item">
				<text>涨跌颜色</text>
				<view class="segment">
					<text
						class="seg"
						:class="{ active: settings.colorMode === 'green-up' }"
						@click="settings.colorMode = 'green-up'"
					>
						绿涨红跌
					</text>
					<text
						class="seg"
						:class="{ active: settings.colorMode === 'red-up' }"
						@click="settings.colorMode = 'red-up'"
					>
						红涨绿跌
					</text>
				</view>
			</view>
			<view class="menu-item" @click="onWallet">
				<text>Web3 钱包</text>
				<text class="muted">{{ walletText }}</text>
			</view>
			<view class="menu-item" @click="goMonitor">
				<text>监控面板</text>
				<text class="muted">埋点 / 接口耗时 ›</text>
			</view>
			<view class="menu-item">
				<text>行情连接</text>
				<text class="muted">{{ socketState.status === 'open' ? '已连接' : '未连接' }}</text>
			</view>
		</view>

		<view v-if="userStore.isLogin" class="logout" @click="onLogout">退出登录</view>
	</view>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { onPullDownRefresh, onShow } from '@dcloudio/uni-app'
import { useUserStore } from '@/stores/user'
import { useSettingsStore } from '@/stores/settings'
import { useMarketStore } from '@/stores/market'
import { bindWallet, getWalletNonce } from '@/api/user'
import { socketState } from '@/utils/socket'
import { connectAndSign } from '@/utils/wallet'
import { formatAmount, shortAddress } from '@/utils/format'

const userStore = useUserStore()
const settings = useSettingsStore()
const market = useMarketStore()
const user = computed(() => userStore.user)

const assetRows = computed(() =>
	Object.entries(user.value?.assets ?? {}).map(([coin, a]) => ({ coin, ...a }))
)

// 资产估值：用实时行情把各币种折算成 USDT
const totalValue = computed(() =>
	assetRows.value.reduce((sum, a) => {
		const price = a.coin === 'USDT' ? 1 : market.tickers[a.coin]?.price ?? 0
		return sum + (a.available + a.frozen) * price
	}, 0)
)

const walletText = computed(() => {
	if (!userStore.isLogin) return '登录后绑定'
	return user.value?.wallet ? shortAddress(user.value.wallet.address) : '未绑定 ›'
})

async function refresh() {
	if (!market.list.length) market.refresh().catch(() => {})
	if (userStore.isLogin) await userStore.fetchMe().catch(() => {})
}

onShow(refresh)

onPullDownRefresh(async () => {
	await refresh()
	uni.stopPullDownRefresh()
})

function goLogin() {
	uni.navigateTo({ url: '/pages/login/login' })
}

function goOrders() {
	if (!userStore.isLogin) return goLogin()
	uni.navigateTo({ url: '/pages-order/list/list' })
}

function goMonitor() {
	uni.navigateTo({ url: '/pages-tools/monitor/monitor' })
}

async function onWallet() {
	if (!userStore.isLogin) return goLogin()
	if (user.value?.wallet) {
		uni.showModal({ title: '已绑定钱包', content: user.value.wallet.address, showCancel: false })
		return
	}
	try {
		const { address, signature } = await connectAndSign(async () => (await getWalletNonce()).message)
		userStore.user = await bindWallet(address, signature)
		uni.showToast({ title: '绑定成功', icon: 'success' })
	} catch (e: any) {
		// 用户在钱包里点了拒绝：EIP-1193 错误码 4001
		const msg = e?.code === 4001 ? '已取消签名' : e?.message || '绑定失败'
		uni.showToast({ title: msg, icon: 'none' })
	}
}

function onLogout() {
	uni.showModal({
		title: '提示',
		content: '确定退出登录吗？',
		success(res) {
			if (!res.confirm) return
			userStore.logout()
			// reLaunch 清空页面栈，避免返回到需要登录的页面
			uni.reLaunch({ url: '/pages/market/market' })
		}
	})
}
</script>

<style scoped>
.page {
  padding-bottom: 40rpx;
}

.profile {
  display: flex;
  align-items: center;
  padding: 40rpx 32rpx;
  background-color: #fff;
}

.avatar {
  width: 96rpx;
  height: 96rpx;
  margin-right: 24rpx;
  border-radius: 50%;
  background-color: var(--otc-primary);
  color: #fff;
  font-size: 40rpx;
  font-weight: 600;
  line-height: 96rpx;
  text-align: center;
}
.avatar.empty {
  background-color: #c4c7cc;
}

.info {
  display: flex;
  flex-direction: column;
}

.name {
  font-size: 34rpx;
  font-weight: 600;
}

.uid {
  margin-top: 6rpx;
  font-size: 22rpx;
}

.small {
  font-size: 22rpx;
}

.assets {
  display: flex;
  flex-direction: column;
}

.total {
  margin: 8rpx 0 16rpx;
  font-size: 48rpx;
  font-weight: 600;
}

.asset-row {
  display: flex;
  justify-content: space-between;
  padding: 18rpx 0;
  border-top: 1rpx solid var(--otc-border);
}

.coin {
  font-weight: 600;
}

.asset-nums {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
}

.menu {
  padding-top: 0;
  padding-bottom: 0;
}

.menu-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 30rpx 0;
  border-bottom: 1rpx solid var(--otc-border);
  font-size: 28rpx;
}
.menu-item:last-child {
  border-bottom: none;
}

.segment {
  display: flex;
  padding: 4rpx;
  background-color: var(--otc-bg);
  border-radius: 8rpx;
}

.seg {
  padding: 6rpx 16rpx;
  font-size: 22rpx;
  color: var(--otc-muted);
  border-radius: 6rpx;
}
.seg.active {
  color: var(--otc-text);
  background-color: #fff;
}

.logout {
  margin: 24rpx;
  padding: 28rpx 0;
  background-color: #fff;
  border-radius: 16rpx;
  color: #f6465d;
  text-align: center;
}
</style>
