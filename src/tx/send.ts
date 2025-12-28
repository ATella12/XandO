import type { Address, EIP1193RequestFn, Hex, WalletRpcSchema } from 'viem'
import {
  appendSuffixToCall,
  getBuilderCode,
  getDataSuffix,
  getForceManualBuilderSuffix,
  hasDataSuffix,
  normalizeHex,
} from '../lib/baseAttribution'
import { getSendCallsDataSuffixSupport } from '../lib/sendCallsCapabilities'

export type AttributionMode = 'capabilities' | 'manual' | 'off'

export type SendCall = {
  to: Address
  data?: Hex
  value?: bigint
  [key: string]: unknown
}

export type SendCallsParams = {
  calls: SendCall[]
  chainId?: number
  account?: Address
  capabilities?: {
    dataSuffix?: Hex
    [key: string]: unknown
  }
}

export type SendCallsFn = (args: SendCallsParams) => Promise<{ id: string }>

export type SendTransactionFn = (args: {
  to: Address
  data?: Hex
  value?: bigint
  chainId?: number
  account?: Address
}) => Promise<Hex>

export type WalletClientLike = {
  request: EIP1193RequestFn<WalletRpcSchema>
}

export type PublicClientLike = {
  call: (args: { to: Address; data?: Hex; account?: Address }) => Promise<unknown>
}

export type SendXandOTxArgs = {
  calls: SendCall[]
  chainId: number
  account?: Address
  sendCallsAsync?: SendCallsFn
  sendTransactionAsync?: SendTransactionFn
  walletClient?: WalletClientLike | null
  publicClient?: PublicClientLike | null
}

export type SendXandOTxResult = {
  method: 'sendCalls' | 'sendTransaction'
  mode: AttributionMode
  id?: string
  hash?: Hex
  calls: SendCall[]
  capabilities?: { dataSuffix?: Hex }
}

let didLogSupport = false
let didLogManualFallback = false

const isSendCallsUnsupported = (error: unknown) => {
  const err = error as { name?: string; message?: string; shortMessage?: string }
  const haystack = `${err?.name ?? ''} ${err?.shortMessage ?? ''} ${err?.message ?? ''}`.toLowerCase()
  return (
    haystack.includes('wallet_sendcalls') ||
    haystack.includes('sendcalls') ||
    haystack.includes('eip-5792') ||
    haystack.includes('method not found') ||
    haystack.includes('method not supported')
  )
}

const isCapabilitiesError = (error: unknown) => {
  const err = error as { message?: string; shortMessage?: string }
  const haystack = `${err?.shortMessage ?? ''} ${err?.message ?? ''}`.toLowerCase()
  return (
    haystack.includes('capabilities') ||
    haystack.includes('datasuffix') ||
    haystack.includes('invalid params')
  )
}

export const logSendCallsPayload = (payload: SendCallsParams) => {
  if (!import.meta.env.DEV) return
  console.log('[Base Attribution] wallet_sendCalls payload', payload)
}

const logSendMode = (mode: AttributionMode, dataSuffix?: Hex) => {
  if (!import.meta.env.DEV) return
  const prefix = dataSuffix ? dataSuffix.slice(0, 10) : 'n/a'
  console.log(`[Base Attribution] mode: ${mode}, suffix prefix: ${prefix}`)
}

const warnManualChecks = (calls: SendCall[], dataSuffix?: Hex) => {
  if (!import.meta.env.DEV || !dataSuffix) return
  calls.forEach((call) => {
    const normalized = normalizeHex(call.data)
    if (!hasDataSuffix(call.data ?? '0x', dataSuffix)) {
      console.warn('[Base Attribution] manual append missing from call data')
    }
    if (/^0x[0-9a-f]{8}$/.test(normalized)) {
      console.warn('[Base Attribution] call data length still 4 bytes after manual append')
    }
  })
}

export const sendXandOTx = async (args: SendXandOTxArgs): Promise<SendXandOTxResult> => {
  const {
    calls,
    chainId,
    account,
    sendCallsAsync,
    sendTransactionAsync,
    walletClient,
    publicClient,
  } = args

  const builderCode = getBuilderCode()
  const dataSuffix = getDataSuffix()
  const forceManual = getForceManualBuilderSuffix()

  const supportsDataSuffix =
    !forceManual && builderCode && dataSuffix
      ? await getSendCallsDataSuffixSupport(walletClient ?? undefined)
      : false

  if (import.meta.env.DEV && !didLogSupport) {
    console.log(`[Base Attribution] sendCalls dataSuffix supported: ${supportsDataSuffix}`)
    didLogSupport = true
  }

  const mode: AttributionMode =
    builderCode && dataSuffix ? (supportsDataSuffix ? 'capabilities' : 'manual') : 'off'
  const callsNormalized = calls.map((call) => ({
    ...call,
    data: call.data ?? '0x',
  }))

  logSendMode(mode, dataSuffix)

  if (sendCallsAsync) {
    const useCapabilities = mode === 'capabilities'
    const useManualFallback = mode === 'manual'

    const callsToSend =
      useManualFallback && builderCode
        ? callsNormalized.map((call) => appendSuffixToCall(call, builderCode))
        : callsNormalized

    if (useManualFallback && import.meta.env.DEV && !didLogManualFallback) {
      console.log('[Base Attribution] using manual append fallback for sendCalls')
      didLogManualFallback = true
    }

    if (useManualFallback) {
      warnManualChecks(callsToSend, dataSuffix)
    }

    const capabilities = useCapabilities && dataSuffix ? { dataSuffix } : undefined
    const payload: SendCallsParams = {
      calls: callsToSend,
      chainId,
      account,
      capabilities,
    }

    logSendCallsPayload(payload)

    try {
      const result = await sendCallsAsync(payload)
      return { method: 'sendCalls', mode, id: result.id, calls: callsToSend, capabilities }
    } catch (error) {
      if (useCapabilities && isCapabilitiesError(error) && builderCode && dataSuffix) {
        const fallbackCalls = callsNormalized.map((call) => appendSuffixToCall(call, builderCode))
        const fallbackPayload: SendCallsParams = {
          calls: fallbackCalls,
          chainId,
          account,
        }
        logSendCallsPayload(fallbackPayload)
        const result = await sendCallsAsync(fallbackPayload)
        return { method: 'sendCalls', mode: 'manual', id: result.id, calls: fallbackCalls }
      }

      if (!isSendCallsUnsupported(error)) {
        throw error
      }
    }
  }

  if (!sendTransactionAsync) {
    throw new Error('sendTransaction is unavailable.')
  }

  if (callsNormalized.length !== 1) {
    throw new Error('sendTransaction only supports a single call.')
  }

  const [call] = callsNormalized
  const data = builderCode ? appendSuffixToCall(call, builderCode).data : call.data ?? '0x'

  if (publicClient) {
    await publicClient.call({
      to: call.to,
      data,
      account: account ?? undefined,
    })
  }

  const hash = await sendTransactionAsync({
    to: call.to,
    data,
    value: call.value,
    chainId,
    account,
  })

  return { method: 'sendTransaction', mode, hash, calls: [call] }
}
