import App from './App'
import { createSSRApp } from 'vue'
import * as Pinia from 'pinia'
import { tracker, trackerPlugin } from '@/utils/tracker'

export function createApp() {
  const app = createSSRApp(App)
  app.use(Pinia.createPinia())
  app.use(trackerPlugin)
  // Vue 运行时错误也上报到埋点
  app.config.errorHandler = (err, instance, info) => {
    console.error(err)
    tracker.error(err, { info })
  }
  return {
    app,
    // App 端 Pinia 需要把实例导出给框架
    Pinia
  }
}
