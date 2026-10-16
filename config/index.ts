// 接口地址配置：用条件编译区分平台
// H5 开发：沿用当前访问的主机名 + 后端端口，电脑和手机浏览器都能直接访问
// H5 线上：页面由后端托管（见 server/src/app.js），接口与页面同域名，自动跟随 http/https
// App：手机里的 localhost 指向手机自己，必须填电脑的局域网 IP 或线上域名
const PORT = 3700
const APP_HOST = '192.168.0.100' // 👉 真机调试时改成你电脑的局域网 IP

let baseUrl = `http://${APP_HOST}:${PORT}`
let wsUrl = `ws://${APP_HOST}:${PORT}/ws`

// #ifdef H5
if (process.env.NODE_ENV === 'production') {
  baseUrl = location.origin
  wsUrl = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`
} else {
  baseUrl = `http://${location.hostname}:${PORT}`
  wsUrl = `ws://${location.hostname}:${PORT}/ws`
}
// #endif

export const BASE_URL = baseUrl
export const WS_URL = wsUrl
