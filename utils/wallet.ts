// 钱包连接与签名，用条件编译区分平台
// H5：浏览器注入的 EIP-1193 provider（MetaMask 等）
// App：没有浏览器插件，需要接入 WalletConnect 等方案，这里先给出提示

export interface SignResult {
  address: string
  signature: string
}

function toHex(text: string): string {
  const bytes = new TextEncoder().encode(text)
  return '0x' + Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

export function hasInjectedWallet(): boolean {
  // #ifdef H5
  return typeof window !== 'undefined' && Boolean((window as any).ethereum)
  // #endif
  // #ifndef H5
  return false
  // #endif
}

// getMessage 在拿到地址后再向后端要待签名消息（含一次性 nonce）
export async function connectAndSign(getMessage: () => Promise<string>): Promise<SignResult> {
  // #ifdef H5
  const ethereum = (window as any).ethereum
  if (!ethereum) throw new Error('未检测到钱包，请先安装 MetaMask 浏览器插件')
  const [address] = (await ethereum.request({ method: 'eth_requestAccounts' })) as string[]
  if (!address) throw new Error('未获取到钱包地址')
  const message = await getMessage()
  // personal_sign 按 EIP-191 签名，后端用 ethers.verifyMessage 恢复地址
  const signature = (await ethereum.request({ method: 'personal_sign', params: [toHex(message), address] })) as string
  return { address, signature }
  // #endif
  // #ifndef H5
  throw new Error('App 端需接入 WalletConnect，当前请在 H5 端绑定钱包')
  // #endif
}
