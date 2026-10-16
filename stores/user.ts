import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type { User } from '@/types'
import * as userApi from '@/api/user'
import { socket } from '@/utils/socket'

export const useUserStore = defineStore('user', () => {
  const token = ref<string>(uni.getStorageSync('token') || '')
  const user = ref<User | null>(null)
  const isLogin = computed(() => Boolean(token.value))

  function setToken(value: string) {
    token.value = value
    if (value) uni.setStorageSync('token', value)
    else uni.removeStorageSync('token')
    socket.setToken(value)
  }

  async function login(username: string, password: string) {
    const res = await userApi.login(username, password)
    setToken(res.token)
    user.value = res.user
  }

  async function register(username: string, password: string) {
    const res = await userApi.register(username, password)
    setToken(res.token)
    user.value = res.user
  }

  async function fetchMe() {
    if (!token.value) return null
    user.value = await userApi.getMe()
    return user.value
  }

  function logout() {
    setToken('')
    user.value = null
  }

  // request.ts 收到 401 时会触发这个事件
  uni.$on('auth:expired', () => {
    token.value = ''
    user.value = null
    socket.setToken('')
  })

  return { token, user, isLogin, setToken, login, register, fetchMe, logout }
})
