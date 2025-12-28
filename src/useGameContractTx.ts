import { useCallback, useEffect, useRef, useState } from 'react'
import {
  useAccount,
  useChainId,
  usePublicClient,
  useSendCalls,
  useSendTransaction,
  useSwitchChain,
  useWaitForCallsStatus,
  useWaitForTransactionReceipt,
  useWalletClient,
} from 'wagmi'
import { base } from 'wagmi/chains'
import { encodeFunctionData, type Hex } from 'viem'
import { gameContractAbi, gameContractAddress } from './contract'
import { sendXandOTx } from './tx/send'
import { getBuilderCode } from './lib/baseAttribution'

type TxState = 'idle' | 'needs_wallet' | 'sending' | 'sent' | 'confirmed' | 'cancelled' | 'error'

type TxStatus = {
  state: TxState
  message?: string
  hash?: `0x${string}`
}

type DebugError = {
  message: string
  shortMessage?: string
  details?: string
  cause?: string
  stack?: string
  raw?: string
}

const isUserRejected = (error: unknown) => {
  const err = error as { code?: number; message?: string }
  return err?.code === 4001 || err?.message?.toLowerCase().includes('user rejected')
}

const toDebugError = (error: unknown): DebugError => {
  if (error instanceof Error) {
    const err = error as Error & {
      shortMessage?: string
      details?: string
      cause?: { shortMessage?: string; message?: string }
    }
    return {
      message: err.message,
      shortMessage: err.shortMessage,
      details: err.details,
      cause: err.cause ? err.cause.shortMessage ?? err.cause.message : undefined,
      stack: err.stack,
      raw: JSON.stringify(err, Object.getOwnPropertyNames(err)),
    }
  }
  return {
    message: 'Unknown error',
    raw: JSON.stringify(error),
  }
}

export const useGameContractTx = () => {
  const { address, isConnected } = useAccount()
  const chainId = useChainId()
  const { switchChainAsync, isPending: isSwitching } = useSwitchChain()
  const { sendCallsAsync } = useSendCalls()
  const { sendTransactionAsync } = useSendTransaction()
  const { data: walletClient } = useWalletClient()
  const publicClient = usePublicClient({ chainId: base.id })
  const [status, setStatus] = useState<TxStatus>({ state: 'idle' })
  const [callId, setCallId] = useState<string | null>(null)
  const [txHash, setTxHash] = useState<`0x${string}` | null>(null)
  const [lastError, setLastError] = useState<DebugError | null>(null)
  const [sendMethod, setSendMethod] = useState<'sendCalls' | 'sendTransaction' | 'none'>('none')
  const resetTimeoutRef = useRef<number | null>(null)

  useEffect(() => {
    getBuilderCode()
  }, [])

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
      setLastError({
        message: 'Call bundle failed.',
        details: callsStatus.statusCode ? `statusCode=${callsStatus.statusCode}` : undefined,
      })
      setCallId(null)
    }
  }, [callId, callsStatus?.receipts, callsStatus?.status, callsStatus?.statusCode])

  const { data: receipt, isSuccess: isConfirmed } = useWaitForTransactionReceipt({
    hash: txHash ?? undefined,
    chainId: base.id,
    query: {
      enabled: !!txHash,
    },
  })

  useEffect(() => {
    if (isConfirmed && receipt?.transactionHash) {
      setStatus({ state: 'confirmed', hash: receipt.transactionHash })
      setTxHash(null)
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
    setLastError(null)
    if (!isConnected || !address) {
      setStatus({ state: 'needs_wallet', message: 'Connect your wallet to start.' })
      return false
    }

    if (!gameContractAddress) {
      setStatus({ state: 'error', message: 'Missing contract address.' })
      setLastError({ message: 'Missing contract address.' })
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
      } catch (error) {
        console.error('switchChain failed', error)
        setLastError(toDebugError(error))
        setStatus({
          state: 'error',
          message: 'Please switch to Base to send the transaction.',
        })
        return false
      }
    }

    return true
  }, [address, chainId, isConnected, switchChainAsync])

  const buildBaseCallData = useCallback(
    (functionName: 'recordStart' | 'recordPlayAgain') => {
      return encodeFunctionData({
        abi: gameContractAbi,
        functionName,
      }) as Hex
    },
    [],
  )

  const sendContractCall = useCallback(
    async (functionName: 'recordStart' | 'recordPlayAgain') => {
      const ok = await ensureReady()
      if (!ok) return
      try {
        setStatus({ state: 'sending' })
        const data = buildBaseCallData(functionName)
        console.log('tx data len', data.length, data.slice(0, 10))
        const result = await sendXandOTx({
          calls: [
            {
              to: gameContractAddress!,
              data,
            },
          ],
          chainId: base.id,
          account: address ?? undefined,
          sendCallsAsync: sendCallsAsync ?? undefined,
          sendTransactionAsync: sendTransactionAsync ?? undefined,
          walletClient: walletClient ?? undefined,
          publicClient: publicClient ?? undefined,
        })
        setSendMethod(result.method)
        if (result.method === 'sendCalls' && result.id) {
          setCallId(result.id)
          setStatus({ state: 'sent' })
          return
        }
        if (result.method === 'sendTransaction' && result.hash) {
          setTxHash(result.hash)
          setStatus({ state: 'sent', hash: result.hash })
          return
        }
      } catch (error) {
        console.error('transaction error', error)
        setLastError(toDebugError(error))
        if (isUserRejected(error)) {
          setStatus({ state: 'cancelled', message: 'Transaction cancelled.' })
        } else {
          setStatus({ state: 'error', message: 'Transaction failed.' })
        }
      }
    },
    [
      address,
      buildBaseCallData,
      ensureReady,
      publicClient,
      sendCallsAsync,
      sendTransactionAsync,
      walletClient,
    ],
  )

  const recordStart = useCallback(async () => {
    await sendContractCall('recordStart')
  }, [sendContractCall])

  const recordPlayAgain = useCallback(async () => {
    await sendContractCall('recordPlayAgain')
  }, [sendContractCall])

  const isPending = status.state === 'sending'
  const expectedChainName = base.name
  const needsChainSwitch = chainId !== base.id

  return {
    recordStart,
    recordPlayAgain,
    status,
    isPending,
    address,
    chainId,
    expectedChainId: base.id,
    expectedChainName,
    needsChainSwitch,
    switchChainAsync,
    isSwitching,
    sendMethod,
    lastError,
  }
}
