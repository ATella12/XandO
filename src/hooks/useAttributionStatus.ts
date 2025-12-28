import { useEffect, useMemo, useState } from 'react'
import { useWalletClient } from 'wagmi'
import { getBuilderCode, getDataSuffix } from '../lib/baseAttribution'
import { getSendCallsDataSuffixSupport } from '../lib/sendCallsCapabilities'

export type AttributionMode = 'capabilities' | 'manual' | 'off'

export const useAttributionStatus = () => {
  const { data: walletClient } = useWalletClient()
  const [dataSuffixSupported, setDataSuffixSupported] = useState<boolean | null>(null)

  const builderCode = getBuilderCode()
  const builderCodePresent = !!builderCode
  const dataSuffix = getDataSuffix()

  useEffect(() => {
    let active = true
    if (!import.meta.env.DEV || !builderCodePresent || !dataSuffix) {
      setDataSuffixSupported(null)
      return () => {
        active = false
      }
    }

    getSendCallsDataSuffixSupport(walletClient ?? undefined)
      .then((supported) => {
        if (active) setDataSuffixSupported(supported)
      })
      .catch(() => {
        if (active) setDataSuffixSupported(false)
      })

    return () => {
      active = false
    }
  }, [builderCodePresent, dataSuffix, walletClient])

  const mode = useMemo<AttributionMode>(() => {
    if (!builderCodePresent) return 'off'
    if (dataSuffixSupported === true) return 'capabilities'
    if (dataSuffixSupported === false) return 'manual'
    return 'off'
  }, [builderCodePresent, dataSuffixSupported])

  return {
    builderCodePresent,
    builderCode: import.meta.env.DEV ? builderCode : undefined,
    dataSuffixSupported,
    mode,
  }
}
