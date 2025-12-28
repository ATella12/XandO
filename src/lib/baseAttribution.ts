import { Attribution } from 'ox/erc8021'
import { type Hex } from 'viem'

let didWarnMissing = false
let didLogActive = false

export const normalizeHex = (value?: string): Hex => {
  if (!value) return '0x'
  if (value === '0x') return '0x'
  return (`0x${value.startsWith('0x') ? value.slice(2) : value}`.toLowerCase()) as Hex
}

export const ensureHex = (value?: string): Hex | undefined => {
  if (!value) return undefined
  const normalized = normalizeHex(value)
  return normalized === '0x' ? undefined : normalized
}

export function getBuilderCode(): string | undefined {
  const code =
    import.meta.env.NEXT_PUBLIC_BASE_BUILDER_CODE ??
    import.meta.env.VITE_BASE_BUILDER_CODE ??
    undefined

  if (!code && import.meta.env.DEV && !didWarnMissing) {
    console.warn(
      'Base builder code is missing. Set NEXT_PUBLIC_BASE_BUILDER_CODE to enable attribution.',
    )
    didWarnMissing = true
  }

  if (code && import.meta.env.DEV && !didLogActive) {
    console.log(`[Base Attribution] active: ${code}`)
    didLogActive = true
  }

  return code
}

export function getForceManualBuilderSuffix(): boolean {
  const value =
    import.meta.env.NEXT_PUBLIC_FORCE_BUILDER_SUFFIX_MANUAL ??
    import.meta.env.VITE_FORCE_BUILDER_SUFFIX_MANUAL ??
    undefined
  if (!value) return false
  return ['true', '1', 'yes'].includes(String(value).toLowerCase())
}

export function getDataSuffix(): Hex | undefined {
  const code = getBuilderCode()
  if (!code) return undefined
  const suffix = Attribution.toDataSuffix({ codes: [code] }) as Hex
  return ensureHex(suffix)
}

export function hasDataSuffix(calldata: Hex, dataSuffix?: Hex): boolean {
  if (!dataSuffix) return false
  const normalizedCalldata = normalizeHex(calldata)
  const normalizedSuffix = normalizeHex(dataSuffix)
  if (normalizedCalldata === '0x') return false

  const suffixBody = normalizedSuffix.slice(2)
  const calldataBody = normalizedCalldata.slice(2)
  return calldataBody.endsWith(suffixBody)
}

export function appendBuilderCodeToCallData(calldata: Hex): Hex {
  return appendBuilderCodeToCalldata(calldata, getBuilderCode())
}

export function appendSuffixToCall<T extends { data?: Hex }>(call: T, code?: string): T {
  return {
    ...call,
    data: appendBuilderCodeToCalldata(call.data ?? '0x', code),
  }
}

export function appendBuilderCodeToCalldata(calldata: Hex, code?: string): Hex {
  if (!code) return calldata
  const dataSuffix = ensureHex(Attribution.toDataSuffix({ codes: [code] }) as Hex)
  if (!dataSuffix) return normalizeHex(calldata)

  const normalizedCalldata = normalizeHex(calldata)
  const normalizedSuffix = normalizeHex(dataSuffix)

  if (normalizedCalldata === '0x') return normalizedSuffix

  const suffixBody = normalizedSuffix.slice(2)
  const calldataBody = normalizedCalldata.slice(2)
  if (calldataBody.endsWith(suffixBody)) return normalizedCalldata

  return (`0x${calldataBody}${suffixBody}`.toLowerCase()) as Hex
}
