<template>
	<view class="kline-wrap">
		<canvas
			:canvas-id="canvasId"
			:id="canvasId"
			class="kline-canvas"
			:style="{ width: width + 'px', height: height + 'px' }"
			disable-scroll
			@touchstart="onTouch"
			@touchmove="onTouch"
			@touchend="onTouchEnd"
		/>
	</view>
</template>

<script setup lang="ts">
// 自绘 K 线图：基于 uni 的 canvas API，H5 / App / 小程序通用，不依赖第三方图表库
// 包含：蜡烛图、MA5 / MA10 均线、成交量柱、最新价虚线、十字光标
import { getCurrentInstance, onMounted, ref, watch } from 'vue'
import type { Kline } from '@/types'

const props = withDefaults(
	defineProps<{
		klines: Kline[]
		upColor: string
		downColor: string
		height?: number
		intraday?: boolean
	}>(),
	{ height: 300, intraday: true }
)

const emit = defineEmits<{ (e: 'select', candle: Kline | null): void }>()

const instance = getCurrentInstance()
const canvasId = `kline-${Math.random().toString(36).slice(2, 8)}`
const width = ref(uni.getSystemInfoSync().windowWidth)
const activeIndex = ref<number | null>(null)
let rectLeft = 0

const RIGHT_W = 58
const TIME_H = 18
const MA_COLORS = { 5: '#f0b90b', 10: '#8e5cf6' }

function ma(list: Kline[], n: number) {
	return list.map((_, i) => {
		if (i < n - 1) return null
		let sum = 0
		for (let k = i - n + 1; k <= i; k++) sum += list[k].close
		return sum / n
	})
}

const pad = (n: number) => String(n).padStart(2, '0')
function timeLabel(ts: number) {
	const d = new Date(ts)
	return props.intraday ? `${pad(d.getHours())}:${pad(d.getMinutes())}` : `${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function fmt(n: number) {
	return n >= 1000 ? n.toFixed(1) : n >= 1 ? n.toFixed(2) : n.toFixed(5)
}

function draw() {
	const list = props.klines
	if (!list.length || !instance) return
	const ctx = uni.createCanvasContext(canvasId, instance.proxy)
	const w = width.value
	const h = props.height
	const chartW = w - RIGHT_W
	const mainH = (h - TIME_H) * 0.74
	const volTop = mainH + 8
	const volH = h - TIME_H - volTop
	const step = chartW / list.length
	const bodyW = Math.max(1, step * 0.7)

	const ma5 = ma(list, 5)
	const ma10 = ma(list, 10)
	let max = -Infinity
	let min = Infinity
	let maxVol = 0
	list.forEach((k, i) => {
		max = Math.max(max, k.high, ma5[i] ?? -Infinity, ma10[i] ?? -Infinity)
		min = Math.min(min, k.low, ma5[i] ?? Infinity, ma10[i] ?? Infinity)
		maxVol = Math.max(maxVol, k.volume)
	})
	const range = max - min || 1
	max += range * 0.06
	min -= range * 0.06
	const y = (p: number) => ((max - p) / (max - min)) * mainH
	const x = (i: number) => i * step + step / 2

	ctx.clearRect(0, 0, w, h)

	// 网格与价格刻度
	ctx.setFontSize(10)
	ctx.setTextBaseline('middle')
	ctx.setTextAlign('left')
	ctx.setLineWidth(0.5)
	for (let i = 0; i <= 4; i++) {
		const gy = (mainH / 4) * i
		ctx.setStrokeStyle('#eef0f3')
		ctx.beginPath()
		ctx.moveTo(0, gy)
		ctx.lineTo(chartW, gy)
		ctx.stroke()
		ctx.setFillStyle('#8a919e')
		ctx.fillText(fmt(max - ((max - min) / 4) * i), chartW + 4, Math.min(Math.max(gy, 6), mainH - 6))
	}

	// 蜡烛与成交量
	list.forEach((k, i) => {
		const color = k.close >= k.open ? props.upColor : props.downColor
		const cx = x(i)
		ctx.setStrokeStyle(color)
		ctx.setFillStyle(color)
		ctx.setLineWidth(1)
		ctx.beginPath()
		ctx.moveTo(cx, y(k.high))
		ctx.lineTo(cx, y(k.low))
		ctx.stroke()
		const top = y(Math.max(k.open, k.close))
		const bodyH = Math.max(1, Math.abs(y(k.open) - y(k.close)))
		ctx.fillRect(cx - bodyW / 2, top, bodyW, bodyH)

		const vh = maxVol ? (k.volume / maxVol) * volH : 0
		ctx.setGlobalAlpha(0.5)
		ctx.fillRect(cx - bodyW / 2, volTop + volH - vh, bodyW, vh)
		ctx.setGlobalAlpha(1)
	})

	// 均线
	;([5, 10] as const).forEach((n) => {
		const data = n === 5 ? ma5 : ma10
		ctx.setStrokeStyle(MA_COLORS[n])
		ctx.setLineWidth(1)
		ctx.beginPath()
		let started = false
		data.forEach((v, i) => {
			if (v == null) return
			if (!started) {
				ctx.moveTo(x(i), y(v))
				started = true
			} else ctx.lineTo(x(i), y(v))
		})
		ctx.stroke()
	})

	// 最新价虚线 + 标签
	const last = list[list.length - 1]
	const ly = y(last.close)
	const lastColor = last.close >= last.open ? props.upColor : props.downColor
	ctx.setLineDash([4, 3], 0)
	ctx.setStrokeStyle(lastColor)
	ctx.beginPath()
	ctx.moveTo(0, ly)
	ctx.lineTo(chartW, ly)
	ctx.stroke()
	ctx.setLineDash([], 0)
	ctx.setFillStyle(lastColor)
	ctx.fillRect(chartW, ly - 8, RIGHT_W, 16)
	ctx.setFillStyle('#ffffff')
	ctx.fillText(fmt(last.close), chartW + 4, ly)

	// 时间刻度
	ctx.setFillStyle('#8a919e')
	ctx.setTextBaseline('top')
	;[0, Math.floor(list.length / 2), list.length - 1].forEach((i, idx) => {
		ctx.setTextAlign(idx === 0 ? 'left' : idx === 1 ? 'center' : 'right')
		ctx.fillText(timeLabel(list[i].time), idx === 2 ? chartW : x(i), h - TIME_H + 4)
	})

	// 十字光标
	if (activeIndex.value != null && list[activeIndex.value]) {
		const k = list[activeIndex.value]
		const cx = x(activeIndex.value)
		const cy = y(k.close)
		ctx.setStrokeStyle('#1e2329')
		ctx.setLineWidth(0.5)
		ctx.setLineDash([3, 3], 0)
		ctx.beginPath()
		ctx.moveTo(cx, 0)
		ctx.lineTo(cx, h - TIME_H)
		ctx.moveTo(0, cy)
		ctx.lineTo(chartW, cy)
		ctx.stroke()
		ctx.setLineDash([], 0)
		ctx.setFillStyle('#1e2329')
		ctx.fillRect(chartW, cy - 8, RIGHT_W, 16)
		ctx.setFillStyle('#ffffff')
		ctx.setTextBaseline('middle')
		ctx.setTextAlign('left')
		ctx.fillText(fmt(k.close), chartW + 4, cy)
	}

	ctx.draw()
}

function onTouch(e: any) {
	const t = e.touches?.[0] || e.changedTouches?.[0]
	if (!t) return
	const tx = t.x ?? t.clientX - rectLeft
	const step = (width.value - RIGHT_W) / props.klines.length
	const i = Math.min(props.klines.length - 1, Math.max(0, Math.floor(tx / step)))
	activeIndex.value = i
	emit('select', props.klines[i])
	draw()
}

function onTouchEnd() {
	activeIndex.value = null
	emit('select', null)
	draw()
}

onMounted(() => {
	uni
		.createSelectorQuery()
		.in(instance?.proxy)
		.select('.kline-wrap')
		.boundingClientRect((rect: any) => {
			if (rect?.width) {
				width.value = rect.width
				rectLeft = rect.left
			}
			draw()
		})
		.exec()
})

watch(
	() => [props.klines, props.upColor],
	() => draw(),
	{ deep: true }
)
</script>

<style scoped>
.kline-wrap {
	width: 100%;
}
</style>
