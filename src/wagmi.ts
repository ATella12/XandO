import { createConfig, http } from 'wagmi'
import { base } from 'wagmi/chains'
import { farcasterMiniApp } from '@farcaster/miniapp-wagmi-connector'
import { injected } from 'wagmi/connectors'

export const createWagmiConfig = (isMiniApp: boolean) => {
  const connectors = isMiniApp
    ? [farcasterMiniApp()]
    : [injected({ shimDisconnect: true })]

  return createConfig({
    chains: [base],
    connectors,
    transports: {
      [base.id]: http(),
    },
    ssr: false,
  })
}
