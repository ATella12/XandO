import { Attribution } from 'ox/erc8021'
import { concatHex, type Hex } from 'viem'

export function buildDataSuffix(code: string): Hex {
  return Attribution.toDataSuffix({ codes: [code] }) as Hex
}

export function appendBuilderCodeToCalldata(calldata: Hex, code: string): Hex {
  return concatHex([calldata, buildDataSuffix(code)])
}
