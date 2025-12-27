import { useEffect, useMemo, useRef, useState } from 'react'
import { sdk } from '@farcaster/miniapp-sdk'
import { useConnect } from 'wagmi'
import { base, baseSepolia } from 'wagmi/chains'
import './App.css'
import WalletPanel from './WalletPanel'
import { useGameContractTx } from './useGameContractTx'

type Cell = 'X' | 'O' | null
type Board = Cell[]
type Mode = 'single' | 'multi'
type Winner = 'X' | 'O' | null

const winningLines: number[][] = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8],
  [0, 4, 8],
  [2, 4, 6],
]

const getWinner = (board: Board): Winner => {
  for (const [a, b, c] of winningLines) {
    const value = board[a]
    if (value && value === board[b] && value === board[c]) {
      return value
    }
  }
  return null
}

const isDraw = (board: Board): boolean =>
  board.every((cell) => cell !== null) && getWinner(board) === null

const availableMoves = (board: Board): number[] =>
  board
    .map((cell, index) => (cell === null ? index : null))
    .filter((value): value is number => value !== null)

const minimax = (board: Board, depth: number, isMaximizing: boolean): number => {
  const winner = getWinner(board)
  if (winner === 'O') return 10 - depth
  if (winner === 'X') return depth - 10
  if (isDraw(board)) return 0

  if (isMaximizing) {
    let bestScore = -Infinity
    for (const move of availableMoves(board)) {
      const nextBoard = [...board]
      nextBoard[move] = 'O'
      bestScore = Math.max(bestScore, minimax(nextBoard, depth + 1, false))
    }
    return bestScore
  }

  let bestScore = Infinity
  for (const move of availableMoves(board)) {
    const nextBoard = [...board]
    nextBoard[move] = 'X'
    bestScore = Math.min(bestScore, minimax(nextBoard, depth + 1, true))
  }
  return bestScore
}

const getBestMove = (board: Board): number | null => {
  let bestScore = -Infinity
  let bestMove: number | null = null
  for (const move of availableMoves(board)) {
    const nextBoard = [...board]
    nextBoard[move] = 'O'
    const score = minimax(nextBoard, 0, false)
    if (score > bestScore) {
      bestScore = score
      bestMove = move
    }
  }
  return bestMove
}

type AppProps = {
  isMiniApp: boolean | null
  walletReady: boolean
}

function App({ isMiniApp, walletReady }: AppProps) {
  const [hasStarted, setHasStarted] = useState(false)
  const [mode, setMode] = useState<Mode | null>(null)
  const [board, setBoard] = useState<Board>(Array(9).fill(null))
  const [currentPlayer, setCurrentPlayer] = useState<'X' | 'O'>('X')
  const {
    recordStart,
    recordPlayAgain,
    status: txStatus,
    isPending: isTxPending,
    address,
    chainId,
    expectedChainId,
    expectedChainName,
    needsChainSwitch,
    switchChainAsync,
    isSwitching,
    sendMethod,
    lastError,
  } = useGameContractTx()
  const { connect, connectors, isPending: isConnectPending } = useConnect()
  const aiTimeoutRef = useRef<number | null>(null)
  const aiThinkingRef = useRef(false)
  const boardRef = useRef(board)
  const currentPlayerRef = useRef(currentPlayer)
  const isGameOverRef = useRef(false)
  const modeRef = useRef(mode)
  const hasStartedRef = useRef(hasStarted)

  useEffect(() => {
    try {
      sdk.actions.ready()
    } catch {
      // Mini App SDK may not be available in a normal browser.
    }
  }, [])

  const winner = useMemo(() => getWinner(board), [board])
  const draw = useMemo(() => isDraw(board), [board])
  const isGameOver = winner !== null || draw

  useEffect(() => {
    boardRef.current = board
  }, [board])

  useEffect(() => {
    currentPlayerRef.current = currentPlayer
  }, [currentPlayer])

  useEffect(() => {
    isGameOverRef.current = isGameOver
  }, [isGameOver])

  useEffect(() => {
    modeRef.current = mode
  }, [mode])

  useEffect(() => {
    hasStartedRef.current = hasStarted
  }, [hasStarted])

  useEffect(() => {
    const shouldThink =
      hasStarted && mode === 'single' && currentPlayer === 'O' && !isGameOver
    if (!shouldThink || aiThinkingRef.current) {
      return
    }

    if (aiTimeoutRef.current !== null) {
      window.clearTimeout(aiTimeoutRef.current)
      aiTimeoutRef.current = null
    }

    aiThinkingRef.current = true
    aiTimeoutRef.current = window.setTimeout(() => {
      const stillEligible =
        hasStartedRef.current &&
        modeRef.current === 'single' &&
        currentPlayerRef.current === 'O' &&
        !isGameOverRef.current

      if (!stillEligible) {
        aiThinkingRef.current = false
        return
      }

      const currentBoard = boardRef.current
      const move = getBestMove(currentBoard)
      if (move === null || currentBoard[move] !== null) {
        aiThinkingRef.current = false
        return
      }

      setBoard((prev) => {
        if (prev[move] !== null || getWinner(prev) || isDraw(prev)) {
          return prev
        }
        const nextBoard = [...prev]
        nextBoard[move] = 'O'
        return nextBoard
      })
      setCurrentPlayer('X')
      aiThinkingRef.current = false
    }, 250)

    return () => {
      if (aiTimeoutRef.current !== null) {
        window.clearTimeout(aiTimeoutRef.current)
        aiTimeoutRef.current = null
      }
      aiThinkingRef.current = false
    }
  }, [currentPlayer, hasStarted, isGameOver, mode])

  const handleStart = () => {
    if (!mode) return
    if (isTxPending) return
    if (!address || needsChainSwitch) return
    setHasStarted(true)
    void recordStart()
  }

  const handleSquareClick = (index: number) => {
    if (!hasStarted || isGameOver || board[index]) {
      return
    }
    if (mode === 'single' && currentPlayer !== 'X') {
      return
    }
    const nextBoard = [...board]
    nextBoard[index] = currentPlayer
    setBoard(nextBoard)
    setCurrentPlayer((prev) => (prev === 'X' ? 'O' : 'X'))
  }

  const handlePlayAgain = () => {
    if (isTxPending) return
    if (!address || needsChainSwitch) return
    setBoard(Array(9).fill(null))
    setCurrentPlayer('X')
    void recordPlayAgain()
  }

  const handleBackToStart = () => {
    setHasStarted(false)
    setBoard(Array(9).fill(null))
    setCurrentPlayer('X')
  }

  const statusText = useMemo(() => {
    if (winner === 'X') return 'Player X wins!'
    if (winner === 'O') return 'Player O wins!'
    if (draw) return 'Draw!'
    return `Player ${currentPlayer}'s turn`
  }, [winner, draw, currentPlayer])

  const walletSection = walletReady && isMiniApp !== null ? (
    <WalletPanel isMiniApp={isMiniApp} txState={txStatus} />
  ) : (
    <div className="wallet wallet-loading">Wallet: loading...</div>
  )

  const handleConnect = () => {
    if (connectors.length === 0) return
    connect({ connector: connectors[0] })
  }

  const handleSwitchChain = async () => {
    if (!switchChainAsync) return
    await switchChainAsync({ chainId: expectedChainId })
  }

  const canSend = !!address && !needsChainSwitch && !isTxPending
  const chainLabel =
    chainId === base.id
      ? base.name
      : chainId === baseSepolia.id
        ? baseSepolia.name
        : chainId
          ? `Chain ${chainId}`
          : 'Unknown'

  return (
    <div className="app">
      {!hasStarted ? (
        <section className="panel">
          <h1>XandO</h1>
          <p className="subtitle">Choose your mode to begin.</p>
          <div className="mode-buttons">
            <button
              className={`mode-button ${mode === 'single' ? 'selected' : ''}`}
              onClick={() => setMode('single')}
              type="button"
            >
              Single Player
            </button>
            <button
              className={`mode-button ${mode === 'multi' ? 'selected' : ''}`}
              onClick={() => setMode('multi')}
              type="button"
            >
              Multiplayer
            </button>
          </div>
          <button className="primary" onClick={handleStart} disabled={!mode || isTxPending}>
            {isTxPending ? 'Sending...' : 'Start Game'}
          </button>
          {!address && (
            <button className="ghost" onClick={handleConnect} disabled={isConnectPending}>
              {isConnectPending ? 'Connecting...' : 'Connect Wallet'}
            </button>
          )}
          {needsChainSwitch && (
            <button className="ghost" onClick={handleSwitchChain} disabled={isSwitching}>
              {isSwitching ? 'Switching...' : `Switch to ${expectedChainName}`}
            </button>
          )}
          {!canSend && address && needsChainSwitch && (
            <p className="subtitle">Wrong network: switch to {expectedChainName}.</p>
          )}
          {!canSend && !address && (
            <p className="subtitle">Connect a wallet to send transactions.</p>
          )}
          {walletSection}
        </section>
      ) : (
        <section className="panel game">
          <div className="header">
            <h1>XandO</h1>
            <p className="status">{statusText}</p>
          </div>
          <div className={`board ${isGameOver ? 'locked' : ''}`}>
            {board.map((cell, index) => (
              <button
                key={index}
                className="square"
                onClick={() => handleSquareClick(index)}
                disabled={
                  !hasStarted ||
                  isGameOver ||
                  cell !== null ||
                  (mode === 'single' && currentPlayer === 'O')
                }
                aria-label={`Square ${index + 1}`}
              >
                {cell}
              </button>
            ))}
          </div>
          {isGameOver && (
            <div className="actions">
              <button className="primary" onClick={handlePlayAgain} disabled={isTxPending}>
                {isTxPending ? 'Sending...' : 'Play Again'}
              </button>
              {!address && (
                <button className="ghost" onClick={handleConnect} disabled={isConnectPending}>
                  {isConnectPending ? 'Connecting...' : 'Connect Wallet'}
                </button>
              )}
              {needsChainSwitch && (
                <button className="ghost" onClick={handleSwitchChain} disabled={isSwitching}>
                  {isSwitching ? 'Switching...' : `Switch to ${expectedChainName}`}
                </button>
              )}
              <button className="ghost" onClick={handleBackToStart}>
                Back to Start
              </button>
            </div>
          )}
          {walletSection}
        </section>
      )}
      <div className="panel" style={{ marginTop: '1.5rem' }}>
        <h2>Debug</h2>
        <p className="subtitle">Connection and transaction diagnostics.</p>
        <div className="wallet">
          <div className="wallet-row">
            <span className="wallet-label">Address</span>
            <span className="wallet-value">{address ?? 'Not connected'}</span>
          </div>
          <div className="wallet-row">
            <span className="wallet-label">Chain</span>
            <span className="wallet-value">
              {chainLabel} {chainId ? `(${chainId})` : ''}
            </span>
          </div>
          <div className="wallet-row">
            <span className="wallet-label">Send method</span>
            <span className="wallet-value">{sendMethod}</span>
          </div>
          <div className="wallet-row">
            <span className="wallet-label">Last error</span>
            <span className="wallet-value">
              {lastError
                ? [lastError.shortMessage, lastError.message, lastError.details, lastError.cause]
                    .filter(Boolean)
                    .join(' | ')
                : 'None'}
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}

export default App
