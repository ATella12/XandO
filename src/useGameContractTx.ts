import { useCallback, useEffect, useRef, useState } from 'react'
import {
  useAccount,
  useChainId,
  useSwitchChain,
  useWaitForTransactionReceipt,
  useWriteContract,
} from 'wagmi'
import { base } from 'wagmi/chains'
import { gameContractAbi, gameContractAddress } from './contract'

type TxState = 'idle' | 'needs_wallet' | 'sending' | 'sent' | 'confirmed' | 'cancelled' | 'error'

type TxStatus = {
  state: TxState
  message?: string
  hash?: `0x${string}`
}

const isUserRejected = (error: unknown) => {
  const err = error as { code?: number; message?: string }
  return err?.code === 4001 || err?.message?.toLowerCase().includes('user rejected')
}

export const useGameContractTx = () => {
  const { address, isConnected } = useAccount()
  const chainId = useChainId()
  const { switchChainAsync } = useSwitchChain()
  const { writeContractAsync } = useWriteContract()
  const [status, setStatus] = useState<TxStatus>({ state: 'idle' })
  const resetTimeoutRef = useRef<number | null>(null)

  const { data: receipt, isSuccess: isConfirmed } = useWaitForTransactionReceipt({
    hash: status.hash,
    chainId: base.id,
    query: {
      enabled: !!status.hash,
    },
  })

  useEffect(() => {
    if (isConfirmed && receipt?.transactionHash) {
      setStatus({ state: 'confirmed', hash: receipt.transactionHash })
    }
  }, [isConfirmed, receipt?.transactionHash])

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
      if (!writeContractAsync) {
        setStatus({ state: 'error', message: 'Transaction failed.' })
        return
      }
      try {
        setStatus({ state: 'sending' })
        const hash = await writeContractAsync({
          address: gameContractAddress!,
          abi: gameContractAbi,
          functionName,
          chainId: base.id,
        })
        setStatus({ state: 'sent', hash })
      } catch (error) {
        if (isUserRejected(error)) {
          setStatus({ state: 'cancelled', message: 'Transaction cancelled.' })
        } else {
          setStatus({ state: 'error', message: 'Transaction failed.' })
        }
      }
    },
    [ensureReady, writeContractAsync],
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
