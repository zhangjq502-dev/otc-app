<template>
	<view class="page">
		<view class="card">
			<text class="section-title">事件统计（共 {{ stats?.total ?? 0 }} 条）</text>
			<view class="grid">
				<view v-for="(count, type) in stats?.byType" :key="type" class="cell">
					<text class="cell-num num">{{ count }}</text>
					<text class="muted small">{{ typeNames[type] || type }}</text>
				</view>
			</view>
		</view>

		<view class="card">
			<text class="section-title">接口耗时</text>
			<view class="table-head muted small">
				<text class="c-url">接口</text>
				<text class="c-n">次数</text>
				<text class="c-n">平均</text>
				<text class="c-n">最大</text>
				<text class="c-n">失败</text>
			</view>
			<view v-for="row in apiRows" :key="row.url" class="table-row small">
				<text class="c-url">{{ row.url }}</text>
				<text class="c-n num">{{ row.count }}</text>
				<text class="c-n num">{{ row.avg }}ms</text>
				<text class="c-n num">{{ row.max }}ms</text>
				<text class="c-n num" :class="{ bad: row.errors }">{{ row.errors }}</text>
			</view>
		</view>

		<view class="card">
			<text class="section-title">页面访问</text>
			<view v-for="(count, page) in stats?.pageViews" :key="page" class="table-row small">
				<text class="c-url">{{ page }}</text>
				<text class="c-n num">{{ count }}</text>
			</view>
		</view>

		<view class="card">
			<text class="section-title">最近错误</text>
			<view v-for="(e, i) in stats?.recentErrors" :key="i" class="error-item small">
				<text class="num muted">{{ formatTime(e.time, false) }} · {{ e.page }}</text>
				<text class="error-msg">{{ e.message }}</text>
			</view>
			<text v-if="!stats?.recentErrors?.length" class="muted small">暂无错误</text>
			<button class="test-btn" size="mini" @click="throwError">触发一个测试错误</button>
		</view>
	</view>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { onPullDownRefresh, onShow } from '@dcloudio/uni-app'
import { http } from '@/utils/request'
import { tracker } from '@/utils/tracker'
import { formatTime } from '@/utils/format'

interface Stats {
	total: number
	byType: Record<string, number>
	pageViews: Record<string, number>
	api: Record<string, { count: number; avg: number; max: number; errors: number }>
	recentErrors: { time: number; page: string; message: string }[]
}

const typeNames: Record<string, string> = {
	page_view: '页面访问',
	api: '接口请求',
	error: '错误',
	click: '点击',
	perf: '性能'
}

const stats = ref<Stats | null>(null)
const apiRows = computed(() =>
	Object.entries(stats.value?.api ?? {})
		.map(([url, s]) => ({ url, ...s }))
		.sort((a, b) => b.avg - a.avg)
)

async function load() {
	// 先把本地队列发出去，等上报完成再拉统计，数据更及时
	await tracker.flush()
	stats.value = await http.get<Stats>('/api/track/stats')
}

onShow(load)

onPullDownRefresh(async () => {
	await load().catch(() => {})
	uni.stopPullDownRefresh()
})

function throwError() {
	setTimeout(() => {
		throw new Error('这是一个用于验证错误监控的测试错误')
	})
	setTimeout(load, 800)
}
</script>

<style scoped>
.section-title {
  display: block;
  margin-bottom: 16rpx;
  font-weight: 600;
}

.small {
  font-size: 22rpx;
}

.grid {
  display: flex;
  flex-wrap: wrap;
}

.cell {
  width: 33.33%;
  display: flex;
  flex-direction: column;
  padding: 12rpx 0;
}

.cell-num {
  font-size: 36rpx;
  font-weight: 600;
}

.table-head,
.table-row {
  display: flex;
  padding: 10rpx 0;
}

.table-row {
  border-top: 1rpx solid var(--otc-border);
}

.c-url {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.c-n {
  width: 90rpx;
  text-align: right;
}

.bad {
  color: #f6465d;
}

.error-item {
  display: flex;
  flex-direction: column;
  padding: 10rpx 0;
  border-top: 1rpx solid var(--otc-border);
}

.error-msg {
  color: #f6465d;
}

.test-btn {
  margin-top: 20rpx;
}
</style>
