<template>
	<view class="page">
		<view class="brand">
			<text class="logo">OTC</text>
			<text class="slogan muted">安全、快捷的法币交易</text>
		</view>

		<view class="form">
			<view class="field">
				<input v-model="username" class="input" placeholder="用户名" maxlength="16" />
			</view>
			<view class="field">
				<input v-model="password" class="input" password placeholder="密码（至少 6 位）" @confirm="submit" />
			</view>
			<button class="btn-primary submit" :loading="loading" :disabled="loading" @click="submit">
				{{ isRegister ? '注册并登录' : '登录' }}
			</button>
			<view class="switch">
				<text class="muted">{{ isRegister ? '已有账号？' : '还没有账号？' }}</text>
				<text class="link" @click="isRegister = !isRegister">{{ isRegister ? '去登录' : '去注册' }}</text>
			</view>
		</view>
	</view>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useUserStore } from '@/stores/user'

const userStore = useUserStore()
const username = ref('')
const password = ref('')
const isRegister = ref(false)
const loading = ref(false)

async function submit() {
	if (!username.value || !password.value) {
		uni.showToast({ title: '请输入用户名和密码', icon: 'none' })
		return
	}
	loading.value = true
	try {
		if (isRegister.value) await userStore.register(username.value, password.value)
		else await userStore.login(username.value, password.value)
		uni.showToast({ title: '登录成功', icon: 'success' })
		// 有上一页就返回（例如从 OTC 下单跳过来），否则回到「我的」
		setTimeout(() => {
			if (getCurrentPages().length > 1) uni.navigateBack()
			else uni.switchTab({ url: '/pages/mine/mine' })
		}, 500)
	} finally {
		loading.value = false
	}
}
</script>

<style scoped>
.page {
  min-height: 100vh;
  padding: 0 48rpx;
  background-color: #fff;
}

.brand {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 100rpx 0 60rpx;
}

.logo {
  font-size: 72rpx;
  font-weight: 800;
  color: var(--otc-primary);
}

.slogan {
  margin-top: 12rpx;
  font-size: 26rpx;
}

.field {
  margin-bottom: 28rpx;
  padding: 24rpx 28rpx;
  background-color: var(--otc-bg);
  border-radius: 12rpx;
}

.input {
  font-size: 30rpx;
}

.submit {
  margin-top: 20rpx;
}

.switch {
  display: flex;
  justify-content: center;
  margin-top: 28rpx;
  font-size: 26rpx;
}

.link {
  margin-left: 8rpx;
  color: #c99400;
}

</style>
