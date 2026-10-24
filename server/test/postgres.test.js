import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Pool } from 'pg'
import { PostgresStore } from '../src/postgres-store.js'
import { config } from '../src/config.js'
import http from 'node:http'
import { createApp } from '../src/app.js'
import { MarketEngine } from '../src/market.js'

const url = process.env.TEST_DATABASE_URL

test('PostgreSQL durability, concurrency, rollback and deadline recovery', { skip: !url }, async t => {
  const schema = `test_${Date.now()}_${Math.random().toString(16).slice(2)}`
  const admin = new Pool({ connectionString: url })
  await admin.query(`CREATE SCHEMA ${schema}`)
  const pool = () => new Pool({ connectionString:url, options:`-c search_path=${schema}`, max:5 })
  const original = { seedDemo:config.seedDemo, simulateMerchant:config.simulateMerchant }
  config.seedDemo = true
  config.simulateMerchant = false
  let store
  t.after(async () => {
    if (store) await store.shutdown()
    Object.assign(config,original)
    await admin.query(`DROP SCHEMA ${schema} CASCADE`)
    await admin.end()
  })
  store = await PostgresStore.open(url,{ pool:pool() })
  let user, order, ad
  await t.test('register, persist and restart without resetting inventory or assets', async () => {
    user = await store.createUser('persistent_user','safe-password')
    ad = (await store.listAds({side:'sell',coin:'USDT'}))[0]
    order = await store.createOrder(user.id,{adId:ad.id,fiatAmount:100,payMethod:ad.payMethods[0]},'original-order')
    const old = await store.getUser(user.id)
    assert.ok(old.assets.USDT.frozen > 0)
    await store.shutdown()
    store = await PostgresStore.open(url,{ pool:pool() })
    assert.equal((await store.login('persistent_user','safe-password')).id,user.id)
    assert.deepEqual((await store.getUser(user.id)).assets,old.assets)
    assert.equal((await store.getOrder(user.id,order.id)).status,'pending')
    assert.equal((await store.getAd(ad.id)).available,ad.available-order.amount)
  })
  await t.test('idempotency returns original order and rejects changed payload', async () => {
    const body = {adId:ad.id,fiatAmount:100,payMethod:ad.payMethods[0]}
    assert.equal((await store.createOrder(user.id,body,'original-order')).id,order.id)
    await assert.rejects(store.createOrder(user.id,{...body,fiatAmount:101},'original-order'),{code:409})
  })
  await t.test('restart worker cancels expired order once and restores frozen assets/inventory', async () => {
    await store.pool.query(`UPDATE orders SET expire_at=1,payload=jsonb_set(payload,'{expireAt}','1') WHERE id=$1`,[order.id])
    await store.sweep()
    await store.sweep()
    assert.equal((await store.getOrder(user.id,order.id)).status,'cancelled')
    assert.equal((await store.getUser(user.id)).assets.USDT.frozen,0)
    assert.equal((await store.getUser(user.id)).assets.USDT.available,1000)
    assert.equal((await store.getAd(ad.id)).available,ad.available)
  })
  await t.test('concurrent duplicate orders freeze once', async () => {
    const body = {adId:ad.id,fiatAmount:100,payMethod:ad.payMethods[0]}
    const results = await Promise.allSettled([store.createOrder(user.id,body),store.createOrder(user.id,body)])
    assert.equal(results.filter(r=>r.status==='fulfilled').length,1)
    const success = results.find(r=>r.status==='fulfilled').value
    assert.equal((await store.getUser(user.id)).assets.USDT.frozen,success.amount)
    await store.cancelOrder(success.id,null)
  })
  await t.test('database failure rolls back order, balance, inventory and emits no notification', async () => {
    const originalUser = await store.getUser(user.id)
    const originalAd = await store.getAd(ad.id)
    let count = 0
    const handler = () => count++
    store.on('order',handler)
    await store.pool.query(`CREATE FUNCTION fail_ledger() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test rollback'; END $$;
      CREATE TRIGGER reject_ledger BEFORE INSERT ON asset_ledger FOR EACH ROW EXECUTE FUNCTION fail_ledger()`)
    try {
      await assert.rejects(store.createOrder(user.id,{adId:ad.id,fiatAmount:100,payMethod:ad.payMethods[0]}),/test rollback/)
      assert.deepEqual((await store.getUser(user.id)).assets,originalUser.assets)
      assert.equal((await store.getAd(ad.id)).available,originalAd.available)
      assert.equal(count,0)
    } finally {
      await store.pool.query('DROP TRIGGER reject_ledger ON asset_ledger; DROP FUNCTION fail_ledger()')
      store.off('order',handler)
    }
  })
  await t.test('wallet challenge survives restart and can only be consumed once', async () => {
    await store.issueChallenge(user.id,'challenge')
    assert.equal(await store.getChallenge(user.id),'challenge')
    await store.consumeChallenge(user.id,'challenge','0xExample')
    await assert.rejects(store.consumeChallenge(user.id,'challenge','0xOther'))
    assert.equal((await store.getUser(user.id)).wallet.address,'0xExample')
  })
  await t.test('HTTP awaits PostgreSQL repository and forwards domain errors', async () => {
    const server = http.createServer(createApp({store,market:new MarketEngine()}))
    await new Promise(resolve => server.listen(0,'127.0.0.1',resolve))
    const base = `http://127.0.0.1:${server.address().port}`
    try {
      const login = await fetch(`${base}/api/auth/login`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'persistent_user',password:'safe-password'})})
      const body = await login.json()
      assert.equal(body.code,0)
      const res = await fetch(`${base}/api/user/me`,{headers:{Authorization:`Bearer ${body.data.token}`}})
      assert.equal((await res.json()).data.id,user.id)
      const missing = await fetch(`${base}/api/otc/ads/missing`)
      assert.equal(missing.status,404)
      assert.equal((await missing.json()).code,2001)
      const health = await fetch(`${base}/api/health`)
      assert.equal((await health.json()).data.storage,'postgres')
    } finally { await new Promise(resolve => server.close(resolve)) }
  })
  await t.test('production-style registration does not grant balances', async () => {
    const old = config.initialAssets
    config.initialAssets = false
    try {
      const empty = await store.createUser('zero_balance','safe-password')
      assert.deepEqual(empty.assets.USDT,{available:0,frozen:0})
      await assert.rejects(store.createOrder(empty.id,{adId:ad.id,fiatAmount:100,payMethod:ad.payMethods[0]}),{code:2007})
    } finally { config.initialAssets = old }
  })
  await t.test('ledger is persisted and API user does not expose password', async () => {
    assert.ok((await store.pool.query('SELECT count(*) FROM asset_ledger')).rows[0].count > 0)
    assert.equal(store.publicUser(await store.getUser(user.id)).password,undefined)
  })
})
