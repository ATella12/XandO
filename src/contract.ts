export const gameContractAddress = import.meta.env
  .VITE_GAME_CONTRACT_ADDRESS as `0x${string}` | undefined

export const gameContractAbi = [
  {
    type: 'function',
    name: 'recordStart',
    stateMutability: 'nonpayable',
    inputs: [],
    outputs: [],
  },
  {
    type: 'function',
    name: 'recordPlayAgain',
    stateMutability: 'nonpayable',
    inputs: [],
    outputs: [],
  },
] as const
