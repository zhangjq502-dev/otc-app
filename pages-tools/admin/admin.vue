<template><view class="card"><view v-if="userStore.user?.role === 'admin'"><input v-model="search" placeholder="搜索用户名" /><button @click="load(1)">查询</button><text>共 {{ total }} 位用户</text><view v-for="u in users" :key="u.id" style="padding:20rpx 0;border-bottom:1px solid #eee" @click="target = u.username"><text>{{ u.username }} · {{ u.role === 'admin' ? '管理员' : '用户' }}</text><view v-for="(a,c) in u.assets" :key="c">{{ c }} 可用 {{ a.available }} / 冻结 {{ a.frozen }}</view><button size="mini" @click="target = u.username">选择充值</button></view><button v-if="page > 1" @click="load(page-1)">上一页</button><button v-if="page*20 < total" @click="load(page+1)">下一页</button><view style="margin-top:30rpx">仅增加模拟资产</view><input v-model="target" placeholder="目标用户名" /><picker :range="coins" @change="coinIndex = Number($event.detail.value)"><view>币种：{{ coins[coinIndex] }}（点击切换）</view></picker><input v-model="amount" type="digit" placeholder="充值数量" /><button :disabled="busy" @click="credit">增加模拟余额</button></view><text v-else>需要管理员登录</text></view></template>
<script setup lang="ts">
import { ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import { http } from '@/utils/request'
import { useUserStore } from '@/stores/user'
import type { User } from '@/types'
const userStore = useUserStore(), users = ref<User[]>([]), total = ref(0), page = ref(1), search = ref(''), target = ref(''), amount = ref(''), busy = ref(false), coinIndex = ref(0)
const coins = ['USDT','BTC','ETH']
async function load(p = 1) { if (userStore.user?.role !== 'admin') return; const d = await http.get<{users:User[];total:number}>('/api/admin/users',{page:p,search:search.value}); users.value=d.users;total.value=d.total;page.value=p }
onShow(async()=>{await userStore.fetchMe(); await load()})
function credit(){ if(busy.value || !target.value || !Number(amount.value)) return; uni.showModal({title:'确认模拟充值',content:`给 ${target.value} 增加 ${amount.value} ${coins[coinIndex.value]}？`,success:async r=>{if(!r.confirm || busy.value)return;busy.value=true;try{await http.post('/api/admin/credits',{username:target.value,coin:coins[coinIndex.value],amount:amount.value});amount.value='';await load(page.value);uni.showToast({title:'操作成功'})}finally{busy.value=false}}}) }
</script>
