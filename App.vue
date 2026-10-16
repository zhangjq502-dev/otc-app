<script setup lang="ts">
import { onLaunch, onShow, onHide, onError, onUnhandledRejection } from '@dcloudio/uni-app'
import { socket } from '@/utils/socket'
import { tracker } from '@/utils/tracker'
import { useUserStore } from '@/stores/user'

onLaunch(() => {
  const userStore = useUserStore()
  socket.setToken(userStore.token)
  socket.connect()
  if (userStore.isLogin) userStore.fetchMe().catch(() => {})
  tracker.collectPerf()
})

// App 从后台回到前台：系统可能已断开长连接，立即检查并重连
onShow(() => socket.ensureConnected())

// 切到后台前把埋点队列发出去，避免丢数据
onHide(() => tracker.flush())

// H5 端由 tracker 监听 window 错误，这里只处理 App / 小程序端，避免重复上报
// #ifndef H5
onError((err) => tracker.error(err))
onUnhandledRejection((e) => tracker.error(e.reason, { kind: 'unhandledrejection' }))
// #endif
</script>

<style>
@charset "UTF-8";
/* 全局样式：显式设置背景和文字颜色，避免系统暗色模式下出现黑底黑字 */
page {
  --otc-primary: #f0b90b;
  --otc-text: #1e2329;
  --otc-muted: #8a919e;
  --otc-bg: #f5f5f5;
  --otc-border: #eef0f3;
  background-color: var(--otc-bg);
  color: var(--otc-text);
  font-size: 28rpx;
  font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Helvetica Neue", sans-serif;
}

.num {
  font-variant-numeric: tabular-nums;
}

.card {
  margin: 24rpx;
  padding: 28rpx;
  background-color: #fff;
  border-radius: 16rpx;
}

.btn-primary {
  background-color: var(--otc-primary);
  color: var(--otc-text);
  font-weight: 600;
  border: none;
}

.btn-primary[disabled] {
  opacity: 0.5;
}

.muted {
  color: var(--otc-muted);
}
</style>
