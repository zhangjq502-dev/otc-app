const production = process.env.NODE_ENV === 'production'

export const config = {
  databaseUrl: process.env.DATABASE_URL,
  seedDemo: process.env.SEED_DEMO_DATA === 'true' || (!production && process.env.SEED_DEMO_DATA !== 'false'),
  simulateMerchant: process.env.SIMULATE_MERCHANT === 'true' || (!production && process.env.SIMULATE_MERCHANT !== 'false'),
  initialAssets: !production,
  allowedOrigins: (process.env.CORS_ORIGINS || '').split(',').filter(Boolean),
  trustProxyHops: Number(process.env.TRUST_PROXY_HOPS || 0),
  adminToken: process.env.ADMIN_TOKEN,
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

export function validateConfig() {
  if (production && (!config.jwtSecret || config.jwtSecret === 'otc-dev-secret-change-me' || config.jwtSecret.length < 32)) {
    throw new Error('Production requires JWT_SECRET with at least 32 characters')
  }
  if (production && !config.databaseUrl) throw new Error('Production requires DATABASE_URL')
}
