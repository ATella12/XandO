import { useEffect, useMemo, useRef, useState } from 'react'
import { sdk } from '@farcaster/miniapp-sdk'
import {
  useAccount,
  useChainId,
  useConnect,
  useSwitchChain,
  useWaitForTransactionReceipt,
  useWriteContract,
} from 'wagmi'
import { base } from 'wagmi/chains'
import './App.css'
import WalletPanel from './WalletPanel'
import { useGameContractTx } from './useGameContractTx'
import { MENU_TX_VALUE, menuContractAbis, menuContractAddresses } from './lib/menuContracts'

type Cell = 'X' | 'O' | null
type Board = Cell[]
type Mode = 'single' | 'multi'
type Winner = 'X' | 'O' | null
type Screen = 'home' | 'menu'
type MenuAction = keyof typeof menuContractAddresses
type MenuStatus = {
  state: 'idle' | 'needs_wallet' | 'switching' | 'confirming' | 'submitted' | 'confirmed' | 'error'
  message?: string
  hash?: `0x${string}`
}

const getScreenFromHash = (): Screen => {
  if (typeof window === 'undefined') return 'home'
  return window.location.hash === '#/menu' ? 'menu' : 'home'
}

const isUserRejected = (error: unknown) => {
  const err = error as { code?: number; message?: string }
  return err?.code === 4001 || err?.message?.toLowerCase().includes('user rejected')
}

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
  const [screen, setScreen] = useState<Screen>(() => getScreenFromHash())
  const [menuStatus, setMenuStatus] = useState<MenuStatus>({ state: 'idle' })
  const [menuTxHash, setMenuTxHash] = useState<`0x${string}` | null>(null)
  const { address: walletAddress, isConnected } = useAccount()
  const chainId = useChainId()
  const { connectAsync, connectors, isPending: isConnecting } = useConnect()
  const { switchChainAsync: switchChainAsyncMenu, isPending: isSwitchingMenu } = useSwitchChain()
  const { writeContractAsync, isPending: isWriting } = useWriteContract()
  const {
    recordStart,
    recordPlayAgain,
    status: txStatus,
    isPending: isTxPending,
    address,
    expectedChainId,
    expectedChainName,
    needsChainSwitch,
    switchChainAsync,
    isSwitching,
  } = useGameContractTx()
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

  useEffect(() => {
    const handleHashChange = () => {
      setScreen(getScreenFromHash())
    }
    window.addEventListener('hashchange', handleHashChange)
    return () => window.removeEventListener('hashchange', handleHashChange)
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

  const handleConnectWallet = async () => {
    if (isConnected) return
    const connector = connectors[0]
    if (!connector) {
      setMenuStatus({ state: 'error', message: 'No wallet connector available.' })
      return
    }
    try {
      setMenuStatus({ state: 'confirming', message: 'Open your wallet to connect.' })
      await connectAsync({ connector })
      setMenuStatus({ state: 'idle' })
    } catch (error) {
      if (isUserRejected(error)) {
        setMenuStatus({ state: 'error', message: 'Connection cancelled.' })
      } else {
        setMenuStatus({ state: 'error', message: 'Connection failed.' })
      }
    }
  }

  const handleMenuAction = async (action: MenuAction) => {
    if (!isConnected || !walletAddress) {
      setMenuStatus({ state: 'needs_wallet', message: 'Connect your wallet to continue.' })
      return
    }

    if (chainId !== base.id) {
      if (!switchChainAsyncMenu) {
        setMenuStatus({ state: 'error', message: 'Please switch to Base to send the transaction.' })
        return
      }
      try {
        setMenuStatus({ state: 'switching', message: 'Switching to Base...' })
        await switchChainAsyncMenu({ chainId: base.id })
      } catch (error) {
        setMenuStatus({ state: 'error', message: 'Please switch to Base to send the transaction.' })
        return
      }
    }

    try {
      setMenuStatus({ state: 'confirming', message: 'Confirm in your wallet...' })
      const hash = await writeContractAsync({
        address: menuContractAddresses[action],
        abi: menuContractAbis[action],
        functionName: action,
        value: MENU_TX_VALUE,
        chainId: base.id,
      })
      setMenuTxHash(hash)
      setMenuStatus({ state: 'submitted', message: 'Submitted.', hash })
    } catch (error) {
      if (isUserRejected(error)) {
        setMenuStatus({ state: 'error', message: 'Transaction cancelled.' })
      } else {
        setMenuStatus({ state: 'error', message: 'Transaction failed.' })
      }
    }
  }

  const { data: menuReceipt, isSuccess: isMenuConfirmed } = useWaitForTransactionReceipt({
    hash: menuTxHash ?? undefined,
    chainId: base.id,
    query: {
      enabled: !!menuTxHash,
    },
  })

  useEffect(() => {
    if (isMenuConfirmed && menuReceipt?.transactionHash) {
      setMenuStatus({ state: 'confirmed', message: 'Confirmed.', hash: menuReceipt.transactionHash })
      setMenuTxHash(null)
    }
  }, [isMenuConfirmed, menuReceipt?.transactionHash])

  const navigateTo = (next: Screen) => {
    setScreen(next)
    const nextHash = next === 'menu' ? '#/menu' : '#/'
    if (window.location.hash !== nextHash) {
      window.location.hash = nextHash
    }
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

  const handleSwitchChain = async () => {
    if (!switchChainAsync) return
    await switchChainAsync({ chainId: expectedChainId })
  }

  const canSend = !!address && !needsChainSwitch && !isTxPending
  const isMenuBusy =
    isConnecting ||
    isSwitchingMenu ||
    isWriting ||
    menuStatus.state === 'confirming' ||
    menuStatus.state === 'submitted' ||
    menuStatus.state === 'switching'

  return (
    <div className="app">
      {screen === 'menu' ? (
        <section className="panel">
          <div className="panel-header">
            <h1>Menu</h1>
            <button className="ghost menu-button" onClick={() => navigateTo('home')} type="button">
              Back
            </button>
          </div>
          <div className="mode-buttons">
            <button
              className="mode-button"
              onClick={() => handleMenuAction('win')}
              type="button"
              disabled={isMenuBusy || !isConnected}
            >
              Win
            </button>
            <button
              className="mode-button"
              onClick={() => handleMenuAction('lose')}
              type="button"
              disabled={isMenuBusy || !isConnected}
            >
              Lose
            </button>
            <button
              className="mode-button"
              onClick={() => handleMenuAction('draw')}
              type="button"
              disabled={isMenuBusy || !isConnected}
            >
              Draw
            </button>
          </div>
          {!isConnected && (
            <button
              className="primary"
              onClick={handleConnectWallet}
              type="button"
              disabled={isConnecting}
            >
              {isConnecting ? 'Connecting...' : 'Connect Wallet'}
            </button>
          )}
          {menuStatus.message && <p className="subtitle">{menuStatus.message}</p>}
          {menuStatus.hash && (
            <a
              className="subtitle"
              href={`https://basescan.org/tx/${menuStatus.hash}`}
              target="_blank"
              rel="noreferrer"
            >
              View on BaseScan
            </a>
          )}
        </section>
      ) : !hasStarted ? (
        <section className="panel">
          <div className="panel-header">
            <h1>XandO</h1>
            <button className="ghost menu-button" onClick={() => navigateTo('menu')} type="button">
              Menu
            </button>
          </div>
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
          {needsChainSwitch && (
            <button className="ghost" onClick={handleSwitchChain} disabled={isSwitching}>
              {isSwitching ? 'Switching...' : `Switch to ${expectedChainName}`}
            </button>
          )}
          {!canSend && address && needsChainSwitch && (
            <p className="subtitle">Wrong network: switch to {expectedChainName}.</p>
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
    </div>
  )
}

export default App
