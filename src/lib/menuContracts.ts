import { parseAbi } from 'viem'

export const MENU_TX_VALUE = 500_000_000_000n

export const menuContractAddresses = {
  win: '0x3a68D19115c18B0C825b54ba8E47b6a808B5797A',
  lose: '0x46d2441Ac890a3450aA8254214C4Ff2De6303c4B',
  draw: '0xf0B93E09b3d7704D52862e2C33851A54f40064Bc',
} as const

export const menuContractAbis = {
  win: parseAbi(['function win() payable']),
  lose: parseAbi(['function lose() payable']),
  draw: parseAbi(['function draw() payable']),
} as const
