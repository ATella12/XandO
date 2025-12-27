import { useCallback, useEffect, useRef, useState } from 'react'
import {
  useAccount,
  useChainId,
  useSendCalls,
  useSwitchChain,
  useWaitForCallsStatus,
} from 'wagmi'
import { base } from 'wagmi/chains'
import { Attribution } from 'ox/erc8021'
import { gameContractAbi, gameContractAddress } from './contract'

type TxState = 'idle' | 'needs_wallet' | 'sending' | 'sent' | 'confirmed' | 'cancelled' | 'error'

type TxStatus = {
  state: TxState
  message?: string
  hash?: `0x${string}`
}

const BUILDER_CODE = 'bc_ynopiw2i'
const BUILDER_DATA_SUFFIX = Attribution.toDataSuffix({ codes: [BUILDER_CODE] })

const isUserRejected = (error: unknown) => {
  const err = error as { code?: number; message?: string }
  return err?.code === 4001 || err?.message?.toLowerCase().includes('user rejected')
}

export const useGameContractTx = () => {
  const { address, isConnected } = useAccount()
  const chainId = useChainId()
  const { switchChainAsync } = useSwitchChain()
  const { sendCallsAsync } = useSendCalls()
  const [status, setStatus] = useState<TxStatus>({ state: 'idle' })
  const [callId, setCallId] = useState<string | null>(null)
  const resetTimeoutRef = useRef<number | null>(null)

  const { data: callsStatus } = useWaitForCallsStatus({
    id: callId ?? undefined,
    query: {
      enabled: !!callId,
    },
  })

  useEffect(() => {
    if (!callId || !callsStatus?.status) return

    if (callsStatus.status === 'success') {
      const receiptHash = callsStatus.receipts?.[0]?.transactionHash
      setStatus({ state: 'confirmed', hash: receiptHash })
      setCallId(null)
      return
    }

    if (callsStatus.status === 'failure') {
      setStatus({ state: 'error', message: 'Transaction failed.' })
      setCallId(null)
    }
  }, [callId, callsStatus?.receipts, callsStatus?.status])

  useEffect(() => {
    if (resetTimeoutRef.current !== null) {
      window.clearTimeout(resetTimeoutRef.current)
      resetTimeoutRef.current = null
    }

    let delay: number | null = null
    if (status.state === 'needs_wallet' || status.state === 'cancelled' || status.state === 'error') {
      delay = 3000
    } else if (status.state === 'sent') {
      delay = 6000
    } else if (status.state === 'confirmed') {
      delay = 8000
    }

    if (delay !== null) {
      resetTimeoutRef.current = window.setTimeout(() => {
        setStatus({ state: 'idle' })
        resetTimeoutRef.current = null
      }, delay)
    }

    return () => {
      if (resetTimeoutRef.current !== null) {
        window.clearTimeout(resetTimeoutRef.current)
        resetTimeoutRef.current = null
      }
    }
  }, [status.state])

  const ensureReady = useCallback(async () => {
    if (!isConnected || !address) {
      setStatus({ state: 'needs_wallet', message: 'Connect your wallet to start.' })
      return false
    }

    if (!gameContractAddress) {
      setStatus({ state: 'error', message: 'Missing contract address.' })
      return false
    }

    if (chainId !== base.id) {
      if (!switchChainAsync) {
        setStatus({
          state: 'error',
          message: 'Please switch to Base to send the transaction.',
        })
        return false
      }
      try {
        await switchChainAsync({ chainId: base.id })
      } catch {
        setStatus({
          state: 'error',
          message: 'Please switch to Base to send the transaction.',
        })
        return false
      }
    }

    return true
  }, [address, chainId, isConnected, switchChainAsync])

  const sendContractCall = useCallback(
    async (functionName: 'recordStart' | 'recordPlayAgain') => {
      const ok = await ensureReady()
      if (!ok) return
      if (!sendCallsAsync) {
        setStatus({ state: 'error', message: 'Transaction failed.' })
        return
      }
      try {
        setStatus({ state: 'sending' })
        const result = await sendCallsAsync({
          calls: [
            {
              to: gameContractAddress!,
              abi: gameContractAbi,
              functionName,
            },
          ],
          chainId: base.id,
          capabilities: {
            dataSuffix: BUILDER_DATA_SUFFIX,
          },
        })
        setCallId(result.id)
        setStatus({ state: 'sent' })
      } catch (error) {
        if (isUserRejected(error)) {
          setStatus({ state: 'cancelled', message: 'Transaction cancelled.' })
        } else {
          setStatus({ state: 'error', message: 'Transaction failed.' })
        }
      }
    },
    [ensureReady, sendCallsAsync],
  )

  const recordStart = useCallback(async () => {
    await sendContractCall('recordStart')
  }, [sendContractCall])

  const recordPlayAgain = useCallback(async () => {
    await sendContractCall('recordPlayAgain')
  }, [sendContractCall])

  const isPending = status.state === 'sending'

  return { recordStart, recordPlayAgain, status, isPending }
}
