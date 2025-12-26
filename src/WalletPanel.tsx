import { useAccount, useConnect, useDisconnect } from 'wagmi'

type WalletPanelProps = {
  isMiniApp: boolean
  txState: {
    state:
      | 'idle'
      | 'needs_wallet'
      | 'sending'
      | 'sent'
      | 'confirmed'
      | 'cancelled'
      | 'error'
    message?: string
    hash?: `0x${string}`
  }
}

const shortenAddress = (address: string) =>
  `${address.slice(0, 6)}...${address.slice(-4)}`

const shortenHash = (hash: string) => `${hash.slice(0, 8)}...${hash.slice(-6)}`

export default function WalletPanel({ isMiniApp, txState }: WalletPanelProps) {
  const { address, isConnected } = useAccount()
  const { connect, connectors, isPending, error } = useConnect()
  const { disconnect } = useDisconnect()

  const handleConnect = () => {
    if (connectors.length === 0) return
    connect({ connector: connectors[0] })
  }

  return (
    <div className="wallet">
      <div className="wallet-row">
        <span className="wallet-label">Wallet</span>
        <span className="wallet-value">
          {isConnected && address ? `Connected: ${shortenAddress(address)}` : 'Not connected'}
        </span>
      </div>
      {!isConnected ? (
        <div className="wallet-buttons">
          <button className="ghost" onClick={handleConnect} disabled={isPending}>
            {isMiniApp ? 'Connect Wallet' : 'Connect Browser Wallet'}
          </button>
        </div>
      ) : (
        <div className="wallet-buttons">
          {!isMiniApp && (
            <button className="ghost" onClick={() => disconnect()}>
              Disconnect
            </button>
          )}
        </div>
      )}
      {txState.state !== 'idle' && (
        <p className="wallet-note">
          {txState.message
            ? txState.message
            : txState.state === 'sending'
              ? 'Transaction sending...'
              : txState.state === 'sent'
                ? `Transaction sent: ${txState.hash ? shortenHash(txState.hash) : ''}`
                : txState.state === 'confirmed'
                  ? `Transaction confirmed: ${txState.hash ? shortenHash(txState.hash) : ''}`
                  : txState.state === 'cancelled'
                    ? 'Transaction cancelled.'
                    : txState.state === 'needs_wallet'
                      ? 'Connect your wallet to start.'
                      : 'Transaction failed.'}
        </p>
      )}
      {error && <p className="wallet-note">Connection failed. Try another wallet.</p>}
    </div>
  )
}
