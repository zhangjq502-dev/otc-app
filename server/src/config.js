export const config = {
  port: Number(process.env.PORT) || 3700,
  jwtSecret: process.env.JWT_SECRET || 'otc-dev-secret-change-me',
  jwtExpiresIn: '7d',
  // 行情推送间隔（毫秒）
  tickInterval: 1000,
  // OTC 订单付款时限（毫秒），真实平台一般是 15 分钟
  orderPayTimeout: 15 * 60 * 1000,
  // 模拟商家行为的延迟：买单付款后商家放币 / 卖单下单后商家付款
  merchantReleaseDelay: 8000,
  merchantPayDelay: 6000
}
