import {test} from 'node:test'
import assert from 'node:assert/strict'
import {Store} from '../src/store.js'
test('admin account reserved, password verified and only admin can credit simulated balances',()=>{
 const store=new Store()
 try{
 const admin=store.login('admin','123456')
 assert.equal(admin.role,'admin')
 assert.throws(()=>store.login('admin','wrong'))
 assert.throws(()=>store.createUser('admin','123456'))
 const user=store.createUser('credit_user','123456')
 assert.throws(()=>store.adminCredit(user.id,{username:user.username,coin:'USDT',amount:10}),{code:403})
 const previous=user.assets.USDT.available
 const result=store.adminCredit(admin.id,{username:user.username,coin:'USDT',amount:'20.01'})
 assert.equal(result.user.assets.USDT.available,previous+20.01)
 assert.throws(()=>store.adminCredit(admin.id,{username:user.username,coin:'USDT',amount:-1}))
 assert.throws(()=>store.adminCredit(admin.id,{username:user.username,coin:'USDT',amount:0.001}))
 assert.throws(()=>store.adminCredit(admin.id,{username:'missing',coin:'USDT',amount:1}),{code:404})
 }finally{store.shutdown()}
})
