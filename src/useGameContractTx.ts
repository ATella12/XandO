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
  useWriteContract,
} from 'wagmi'
import { base } from 'wagmi/chains'
import { encodeFunctionData, type Hex } from 'viem'
import { gameContractAbi, gameContractAddress } from './contract'
import { appendBuilderCodeToCalldata, buildDataSuffix } from './lib/baseAttribution'

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

const BUILDER_CODE = 'bc_ynopiw2i'
const BUILDER_DATA_SUFFIX = buildDataSuffix(BUILDER_CODE)

const isUserRejected = (error: unknown) => {
  const err = error as { code?: number; message?: string }
  return err?.code === 4001 || err?.message?.toLowerCase().includes('user rejected')
}

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
    haystack.includes('dataSuffix') ||
    haystack.includes('invalid params')
  )
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
  const { writeContractAsync } = useWriteContract()
  const publicClient = usePublicClient({ chainId: base.id })
  const [status, setStatus] = useState<TxStatus>({ state: 'idle' })
  const [callId, setCallId] = useState<string | null>(null)
  const [txHash, setTxHash] = useState<`0x${string}` | null>(null)
  const [lastError, setLastError] = useState<DebugError | null>(null)
  const [sendMethod, setSendMethod] = useState<
    'sendCalls' | 'sendTransaction' | 'writeContract' | 'none'
  >('none')
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

  const simulateWrite = useCallback(
    async (functionName: 'recordStart' | 'recordPlayAgain', includeSuffix: boolean) => {
      if (!publicClient) {
        throw new Error('Public client not available for simulation.')
      }
      const simulation = await publicClient.simulateContract({
        address: gameContractAddress!,
        abi: gameContractAbi,
        functionName,
        account: address ?? undefined,
        dataSuffix: includeSuffix ? BUILDER_DATA_SUFFIX : undefined,
      })
      return simulation.request
    },
    [address, publicClient],
  )

  const sendWithWriteContract = useCallback(
    async (functionName: 'recordStart' | 'recordPlayAgain', includeSuffix: boolean) => {
      if (!writeContractAsync) {
        throw new Error('writeContract is unavailable.')
      }
      const request = await simulateWrite(functionName, includeSuffix)
      return await writeContractAsync({
        ...request,
        dataSuffix: includeSuffix ? BUILDER_DATA_SUFFIX : undefined,
      })
    },
    [simulateWrite, writeContractAsync],
  )

  const sendWithManualTransaction = useCallback(
    async (functionName: 'recordStart' | 'recordPlayAgain') => {
      if (!sendTransactionAsync) {
        throw new Error('sendTransaction is unavailable.')
      }
      await simulateWrite(functionName, true)
      const baseData = encodeFunctionData({
        abi: gameContractAbi,
        functionName,
      }) as Hex
      const data = appendBuilderCodeToCalldata(baseData, BUILDER_CODE)
      return await sendTransactionAsync({
        to: gameContractAddress!,
        data,
        value: 0n,
        chainId: base.id,
      })
    },
    [sendTransactionAsync, simulateWrite],
  )

  const sendContractCall = useCallback(
    async (functionName: 'recordStart' | 'recordPlayAgain') => {
      const ok = await ensureReady()
      if (!ok) return
      try {
        setStatus({ state: 'sending' })
        if (sendCallsAsync) {
          try {
            setSendMethod('sendCalls')
            const result = await sendCallsAsync({
              calls: [
                {
                  to: gameContractAddress!,
                  abi: gameContractAbi,
                  functionName,
                },
              ],
              chainId: base.id,
              account: address,
              capabilities: {
                dataSuffix: { data: BUILDER_DATA_SUFFIX },
              },
            })
            setCallId(result.id)
            setStatus({ state: 'sent' })
            return
          } catch (error) {
            console.error('sendCalls failed', error)
            if (isCapabilitiesError(error)) {
              try {
                const result = await sendCallsAsync({
                  calls: [
                    {
                      to: gameContractAddress!,
                      abi: gameContractAbi,
                      functionName,
                    },
                  ],
                  chainId: base.id,
                  account: address,
                })
                setCallId(result.id)
                setStatus({ state: 'sent' })
                return
              } catch (retryError) {
                console.error('sendCalls retry without capabilities failed', retryError)
              }
            }
            if (!isSendCallsUnsupported(error)) {
              throw error
            }
          }
        }

        setSendMethod('sendTransaction')
        try {
          const hash = await sendWithManualTransaction(functionName)
          setTxHash(hash)
          setStatus({ state: 'sent', hash })
          return
        } catch (error) {
          console.error('sendTransaction with appended data failed', error)
        }

        setSendMethod('writeContract')
        const hash = await sendWithWriteContract(functionName, true)
        setTxHash(hash)
        setStatus({ state: 'sent', hash })
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
    [address, ensureReady, sendCallsAsync, sendWithManualTransaction, sendWithWriteContract],
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
