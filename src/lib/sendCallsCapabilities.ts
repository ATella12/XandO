import type { EIP1193RequestFn, WalletRpcSchema } from 'viem'

type WalletClientLike = {
  request: EIP1193RequestFn<WalletRpcSchema>
}

let cachedDataSuffixSupport: boolean | null = null
let cachedDataSuffixSupportPromise: Promise<boolean> | null = null

export const supportsDataSuffixCapability = (capabilities: unknown): boolean => {
  if (!capabilities || typeof capabilities !== 'object') return false
  const record = capabilities as Record<string, unknown>
  const sendCalls = record.wallet_sendCalls ?? record['wallet_sendCalls']
  if (!sendCalls || typeof sendCalls !== 'object') return false

  const sendCallsRecord = sendCalls as Record<string, unknown>
  const sendCallsCaps = (sendCallsRecord.capabilities ?? sendCallsRecord) as
    | Record<string, unknown>
    | unknown[]

  if (Array.isArray(sendCallsCaps)) {
    return sendCallsCaps.includes('dataSuffix')
  }

  if (!sendCallsCaps || typeof sendCallsCaps !== 'object') return false
  const dataSuffix =
    (sendCallsCaps as Record<string, unknown>).dataSuffix ??
    (sendCallsCaps as Record<string, unknown>).data_suffix

  if (typeof dataSuffix === 'boolean') return dataSuffix

  if (dataSuffix && typeof dataSuffix === 'object') {
    const dataSuffixRecord = dataSuffix as Record<string, unknown>
    if (typeof dataSuffixRecord.supported === 'boolean') return dataSuffixRecord.supported
    if (typeof dataSuffixRecord.enabled === 'boolean') return dataSuffixRecord.enabled
  }

  return false
}

export const getSendCallsDataSuffixSupport = async (walletClient?: WalletClientLike) => {
  if (!walletClient?.request) return false
  if (cachedDataSuffixSupport !== null) return cachedDataSuffixSupport
  if (cachedDataSuffixSupportPromise) return cachedDataSuffixSupportPromise

  cachedDataSuffixSupportPromise = (async () => {
    try {
      const capabilities = await (walletClient.request as unknown as (args: {
        method: string
        params?: unknown[]
      }) => Promise<unknown>)({
        method: 'wallet_getCapabilities',
        params: [],
      })
      const supported = supportsDataSuffixCapability(capabilities)
      cachedDataSuffixSupport = supported
      return supported
    } catch {
      cachedDataSuffixSupport = false
      return false
    } finally {
      cachedDataSuffixSupportPromise = null
    }
  })()

  return cachedDataSuffixSupportPromise
}
