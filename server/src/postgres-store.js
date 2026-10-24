// Small single-service repository. A transaction lock serializes state transitions;
// replace with scoped row locks before scaling writes across multiple instances.
import { EventEmitter } from 'node:events'
import { Pool } from 'pg'
import { Store, ORDER_STATUS, AppError } from './store.js'
import { config } from './config.js'

const LOCK_ID = 73190241
export const schema = `
CREATE TABLE IF NOT EXISTS schema_migrations (version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS app_users (
 id text PRIMARY KEY, username text NOT NULL UNIQUE, payload jsonb NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS users_wallet_unique ON app_users(lower(payload #>> '{wallet,address}')) WHERE payload #>> '{wallet,address}' IS NOT NULL;
CREATE TABLE IF NOT EXISTS assets (
 user_id text NOT NULL REFERENCES app_users(id), coin text NOT NULL,
 available numeric(30,8) NOT NULL CHECK (available >= 0),
 frozen numeric(30,8) NOT NULL CHECK (frozen >= 0), PRIMARY KEY(user_id,coin)
);
CREATE TABLE IF NOT EXISTS ads (id text PRIMARY KEY, payload jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS orders (
 id text PRIMARY KEY, user_id text NOT NULL REFERENCES app_users(id),
 status text NOT NULL CHECK (status IN ('pending','paid','completed','cancelled')),
 expire_at bigint NOT NULL, payload jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS orders_user_idx ON orders(user_id);
CREATE INDEX IF NOT EXISTS orders_expiry_idx ON orders(expire_at) WHERE status='pending';
CREATE TABLE IF NOT EXISTS asset_ledger (
 id bigserial PRIMARY KEY, user_id text NOT NULL REFERENCES app_users(id), coin text NOT NULL,
 order_id text, action text NOT NULL, available_delta numeric(30,8) NOT NULL,
 frozen_delta numeric(30,8) NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS idempotency_keys (
 user_id text NOT NULL REFERENCES app_users(id), key text NOT NULL, request jsonb NOT NULL,
 order_id text NOT NULL REFERENCES orders(id), PRIMARY KEY(user_id,key)
);
CREATE TABLE IF NOT EXISTS wallet_challenges (
 user_id text PRIMARY KEY REFERENCES app_users(id), nonce text NOT NULL, expires_at bigint NOT NULL
);
INSERT INTO schema_migrations(version) VALUES (1) ON CONFLICT DO NOTHING;
`

export function databaseTls(connectionString, ca = process.env.DATABASE_CA_CERT) {
  if (!ca) return undefined
  const url = new URL(connectionString)
  for (const key of ['sslmode', 'sslcert', 'sslkey', 'sslrootcert']) {
    if (url.searchParams.has(key)) throw new Error('With DATABASE_CA_CERT, omit SSL parameters from DATABASE_URL')
  }
  return { ca: ca.replace(/\\n/g, '\n'), rejectUnauthorized: true }
}

export class PostgresStore extends EventEmitter {
  constructor(pool) {
    super()
    this.pool = pool
    this.events = [] // telemetry is bounded, intentionally not financial state
  }

  static async open(connectionString, { pool } = {}) {
    const store = new PostgresStore(pool || new Pool({ connectionString, ssl: databaseTls(connectionString), max: 5,
      connectionTimeoutMillis: 10000, statement_timeout: 15000 }))
    try {
      await store.transaction(async (db) => {
        await db.query(schema)
        if (config.seedDemo && !(await db.query('SELECT 1 FROM app_users LIMIT 1')).rowCount && !(await db.query('SELECT 1 FROM ads LIMIT 1')).rowCount) {
          const seed = new Store()
          seed.shutdown()
          await store.save(db, seed, new Map(), 'seed')
        }
      })
      await store.transaction(async db => {
        const state = await store.load(db), before = structuredClone(state.users)
        state.ensureAdmin()
        await store.save(db,state,before,'bootstrapAdmin')
      })
      await store.sweep()
      store.worker = setInterval(() => {
        if (store.sweeping) return
        store.sweeping = true
        store.sweep().catch(err => console.error('Order worker failed',err.message))
          .finally(() => { store.sweeping = false })
      }, 1000)
      store.worker.unref()
      return store
    } catch (err) { await store.pool.end(); throw err }
  }

  async transaction(fn) {
    const db = await this.pool.connect()
    try {
      await db.query('BEGIN')
      await db.query('SELECT pg_advisory_xact_lock($1)', [LOCK_ID])
      const result = await fn(db)
      await db.query('COMMIT')
      return result
    } catch (err) {
      await db.query('ROLLBACK')
      if (err.code === '23505') throw new AppError(409, '用户名或钱包已被使用', 409)
      throw err
    }
    finally { db.release() }
  }

  async load(db) {
    const state = new Store({ seed: false })
    const users = await db.query('SELECT payload FROM app_users')
    for (const { payload } of users.rows) state.users.set(payload.id, { ...payload, assets: {} })
    const assets = await db.query('SELECT * FROM assets')
    for (const a of assets.rows) state.users.get(a.user_id).assets[a.coin] = { available: Number(a.available), frozen: Number(a.frozen) }
    state.ads = (await db.query('SELECT payload FROM ads')).rows.map(r => r.payload)
    for (const { payload } of (await db.query('SELECT payload FROM orders')).rows) state.orders.set(payload.id, payload)
    state.originalAds = new Map(state.ads.map(a => [a.id,JSON.stringify(a)]))
    state.originalOrders = new Map([...state.orders].map(([id,o]) => [id,JSON.stringify(o)]))
    state.schedule = () => {} // deadlines are recovered from persisted timestamps
    state.events = this.events
    return state
  }

  async save(db, state, before, action) {
    // Persist only changed rows; all changes commit together with the ledger.
    for (const user of state.users.values()) {
      const { assets, ...payload } = user
      const old = before.get(user.id)
      if (!old || JSON.stringify({ ...old, assets: undefined }) !== JSON.stringify({ ...payload, assets: undefined })) {
        await db.query(`INSERT INTO app_users(id,username,payload) VALUES($1,$2,$3)
          ON CONFLICT(id) DO UPDATE SET username=EXCLUDED.username,payload=EXCLUDED.payload`, [user.id,user.username,payload])
      }
      for (const [coin, balance] of Object.entries(assets)) {
        const prev = old?.assets?.[coin] || { available: 0, frozen: 0 }
        if (old && prev.available === balance.available && prev.frozen === balance.frozen) continue
        await db.query(`INSERT INTO assets VALUES($1,$2,$3,$4) ON CONFLICT(user_id,coin)
          DO UPDATE SET available=EXCLUDED.available,frozen=EXCLUDED.frozen`,[user.id,coin,balance.available,balance.frozen])
        await db.query(`INSERT INTO asset_ledger(user_id,coin,action,available_delta,frozen_delta,order_id)
          VALUES($1,$2,$3,$4::numeric-$5::numeric,$6::numeric-$7::numeric,$8)`,
          [user.id,coin,action,balance.available,prev.available,balance.frozen,prev.frozen,state.changedOrderId || null])
      }
    }
    for (const ad of state.ads) {
      if (state.originalAds?.get(ad.id) === JSON.stringify(ad)) continue
      await db.query(`INSERT INTO ads VALUES($1,$2) ON CONFLICT(id) DO UPDATE SET payload=EXCLUDED.payload`,[ad.id,ad])
      state.originalAds?.set(ad.id,JSON.stringify(ad))
    }
    for (const order of state.orders.values()) {
      if (state.originalOrders?.get(order.id) === JSON.stringify(order)) continue
      await db.query(`INSERT INTO orders VALUES($1,$2,$3,$4,$5)
      ON CONFLICT(id) DO UPDATE SET status=EXCLUDED.status,expire_at=EXCLUDED.expire_at,payload=EXCLUDED.payload`,
      [order.id,order.userId,order.status,order.expireAt,order])
      state.originalOrders?.set(order.id,JSON.stringify(order))
    }
  }

  async execute(method, args, write = false) {
    const notifications = []
    const result = await this.transaction(async db => {
      const key = method === 'createOrder' ? args[2] : null
      if (key) {
        if (typeof key !== 'string' || key.length > 128) throw new AppError(400, '幂等键长度不能超过 128')
        const found = await db.query(`SELECT k.request,o.payload FROM idempotency_keys k JOIN orders o ON o.id=k.order_id
          WHERE k.user_id=$1 AND k.key=$2`, [args[0],key])
        if (found.rowCount) {
          const old = found.rows[0]
          if (Object.keys({...old.request,...args[1]}).some(k => JSON.stringify(old.request[k]) !== JSON.stringify(args[1][k]))) {
            throw new AppError(409, '该幂等键已用于不同的下单请求', 409)
          }
          return old.payload
        }
      }
      const state = await this.load(db)
      const before = structuredClone(state.users)
      state.on('order', order => { state.changedOrderId = order.id; notifications.push(structuredClone(order)) })
      const value = state[method](...args)
      if (write) await this.save(db,state,before,method === 'adminCredit' ? `adminCredit:${args[0]}` : method)
      if (key) await db.query('INSERT INTO idempotency_keys VALUES($1,$2,$3,$4)',[args[0],key,args[1],value.id])
      return value
    })
    // Never notify clients of changes that were rolled back.
    for (const order of notifications) this.emit('order',order)
    return result
  }

  async sweep() {
    // Re-evaluate state under the same transaction lock; no stale timer callbacks.
    const notifications = []
    await this.transaction(async db => {
      const state = await this.load(db)
      for (const order of state.orders.values()) {
        const before = structuredClone(state.users)
        const now = Date.now()
        state.changedOrderId = order.id
        let changed = false
        if (order.status === ORDER_STATUS.PENDING && order.expireAt <= now) {
          state.cancelOrder(order.id,null,'超时未付款，系统自动取消'); changed = true
        } else if (config.simulateMerchant && order.side === 'sell' && order.status === ORDER_STATUS.PENDING && order.createdAt + config.merchantPayDelay <= now) {
          state.markPaid(order.id,null); changed = true
        } else if (config.simulateMerchant && order.side === 'buy' && order.status === ORDER_STATUS.PAID && order.paidAt + config.merchantReleaseDelay <= now) {
          state.complete(order.id,null); changed = true
        }
        if (changed) { await this.save(db,state,before,'worker'); notifications.push(structuredClone(order)) }
      }
    })
    for (const order of notifications) this.emit('order',order)
  }

  async ping() { await this.pool.query('SELECT 1') }

  async issueChallenge(userId, nonce) {
    await this.transaction(async db => {
      await db.query(`INSERT INTO wallet_challenges VALUES($1,$2,$3)
        ON CONFLICT(user_id) DO UPDATE SET nonce=EXCLUDED.nonce,expires_at=EXCLUDED.expires_at`,[userId,nonce,Date.now()+300000])
    })
  }
  async getChallenge(userId) {
    const result = await this.pool.query('SELECT nonce FROM wallet_challenges WHERE user_id=$1 AND expires_at>$2',[userId,Date.now()])
    return result.rows[0]?.nonce
  }
  async consumeChallenge(userId, nonce, address) {
    return this.transaction(async db => {
      const deleted = await db.query('DELETE FROM wallet_challenges WHERE user_id=$1 AND nonce=$2 AND expires_at>$3 RETURNING user_id',[userId,nonce,Date.now()])
      if (!deleted.rowCount) throw new AppError(1101, '钱包验证已过期，请重试')
      const state = await this.load(db), before = structuredClone(state.users)
      const user = state.bindWallet(userId,address)
      await this.save(db,state,before,'bindWallet')
      return user
    })
  }
  publicUser(user) { const { password, ...rest } = user; return rest }
  addEvents(...args) { return Store.prototype.addEvents.apply(this,args) }
  trackStats() { return Store.prototype.trackStats.call(this) }
  async shutdown() { clearInterval(this.worker); await this.pool.end() }
}
for (const method of ['getUser','login','listAds','getAd','getOrder','listOrders','adminUsers']) {
  PostgresStore.prototype[method] = function(...args) { return this.execute(method,args) }
}
for (const method of ['createUser','createOrder','markPaid','release','complete','cancelOrder','bindWallet','adminCredit']) {
  PostgresStore.prototype[method] = function(...args) { return this.execute(method,args,true) }
}
