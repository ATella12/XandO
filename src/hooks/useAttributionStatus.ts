import { useEffect, useMemo, useState } from 'react'
import { useWalletClient } from 'wagmi'
import { getBuilderCode, getDataSuffix, getForceManualBuilderSuffix } from '../lib/baseAttribution'
import { getSendCallsDataSuffixSupport } from '../lib/sendCallsCapabilities'

export type AttributionMode = 'capabilities' | 'manual' | 'off'

export const useAttributionStatus = () => {
  const { data: walletClient } = useWalletClient()
  const [dataSuffixSupported, setDataSuffixSupported] = useState<boolean | null>(null)

  const builderCode = getBuilderCode()
  const builderCodePresent = !!builderCode
  const forceManual = getForceManualBuilderSuffix()
  const dataSuffix = getDataSuffix()
  const shouldCheckDataSuffix =
    import.meta.env.DEV && builderCodePresent && !!dataSuffix && !forceManual
  const effectiveDataSuffixSupported = shouldCheckDataSuffix ? dataSuffixSupported : null

  useEffect(() => {
    let active = true
    if (!shouldCheckDataSuffix) {
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
  }, [shouldCheckDataSuffix, walletClient])

  const mode = useMemo<AttributionMode>(() => {
    if (!builderCodePresent) return 'off'
    if (forceManual) return 'manual'
    if (effectiveDataSuffixSupported === true) return 'capabilities'
    if (effectiveDataSuffixSupported === false) return 'manual'
    return 'off'
  }, [builderCodePresent, effectiveDataSuffixSupported, forceManual])

  return {
    builderCodePresent,
    builderCode: import.meta.env.DEV ? builderCode : undefined,
    dataSuffixSupported: effectiveDataSuffixSupported,
    mode,
  }
}
