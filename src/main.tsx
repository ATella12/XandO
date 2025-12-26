import { StrictMode, useEffect, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { WagmiProvider } from 'wagmi'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { sdk } from '@farcaster/miniapp-sdk'
import { createWagmiConfig } from './wagmi'

const queryClient = new QueryClient()

function Root() {
  const [isMiniApp, setIsMiniApp] = useState<boolean | null>(null)

  useEffect(() => {
    let active = true
    const detect = async () => {
      try {
        const result = await sdk.isInMiniApp()
        if (active) setIsMiniApp(result)
      } catch {
        if (active) setIsMiniApp(false)
      }
    }
    detect()
    return () => {
      active = false
    }
  }, [])

  const config = useMemo(() => createWagmiConfig(isMiniApp ?? false), [isMiniApp])

  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <App isMiniApp={isMiniApp} walletReady={isMiniApp !== null} />
      </QueryClientProvider>
    </WagmiProvider>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
)
