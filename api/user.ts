import { http } from '@/utils/request'
import type { User } from '@/types'

interface AuthResult {
  token: string
  user: User
}

export const login = (username: string, password: string) =>
  http.post<AuthResult>('/api/auth/login', { username, password })

export const register = (username: string, password: string) =>
  http.post<AuthResult>('/api/auth/register', { username, password })

export const getMe = () => http.get<User>('/api/user/me', undefined, true)

export const getWalletNonce = () => http.get<{ message: string }>('/api/user/wallet/nonce')

export const bindWallet = (address: string, signature: string) =>
  http.post<User>('/api/user/wallet', { address, signature })
