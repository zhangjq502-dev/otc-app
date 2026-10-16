// 接口地址配置：用条件编译区分平台
// H5：沿用当前访问的主机名，电脑和手机浏览器都能直接访问
// App：手机里的 localhost 指向手机自己，必须填电脑的局域网 IP
const PORT = 3700
const APP_HOST = '192.168.0.100' // 👉 真机调试时改成你电脑的局域网 IP

let host = APP_HOST
// #ifdef H5
host = location.hostname
// #endif

export const BASE_URL = `http://${host}:${PORT}`
export const WS_URL = `ws://${host}:${PORT}/ws`
