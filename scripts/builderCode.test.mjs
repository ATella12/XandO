import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import vm from 'node:vm'
import ts from 'typescript'

const require = createRequire(import.meta.url)
const root = process.cwd()
const sourcePath = path.join(root, 'src', 'lib', 'baseAttribution.ts')
const source = fs.readFileSync(sourcePath, 'utf8')
const transpiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2019,
  },
})
const transformed = transpiled.outputText.replaceAll('import.meta', 'globalThis.__importMeta')

const module = { exports: {} }
const sandbox = {
  module,
  exports: module.exports,
  require,
  console,
  TextEncoder,
  __importMeta: { env: {} },
}

vm.runInNewContext(transformed, sandbox, { filename: sourcePath })

const helpers = sandbox.module.exports

assert.equal(helpers.getBuilderCode(), 'bc_ynopiw2i')

const expectedSuffix =
  '0x' + Buffer.from('bc_ynopiw2i', 'utf8').toString('hex') + '0b0080218021802180218021802180218021'

assert.equal(helpers.getDataSuffix(), expectedSuffix)
assert.equal(helpers.ensureBuilderCodeSuffix('0x1234'), `0x1234${expectedSuffix.slice(2)}`)
assert.equal(helpers.ensureBuilderCodeSuffix(undefined), expectedSuffix)
assert.equal(helpers.ensureBuilderCodeSuffix(null), expectedSuffix)
assert.equal(helpers.ensureBuilderCodeSuffix('0x'), expectedSuffix)
assert.equal(helpers.ensureBuilderCodeSuffix(expectedSuffix), expectedSuffix)
assert.equal(helpers.appendBuilderCodeToCalldata('0x1234', 'bc_ynopiw2i'), `0x1234${expectedSuffix.slice(2)}`)
assert.equal(helpers.hasDataSuffix(expectedSuffix, expectedSuffix), true)
assert.equal(helpers.hasDataSuffix(`0x1234${expectedSuffix.slice(2)}`, expectedSuffix), true)
assert.equal(helpers.hasDataSuffix('0x1234', expectedSuffix), false)
assert.equal(helpers.hasDataSuffix(`0x1234${expectedSuffix.slice(2, -2)}ff`, expectedSuffix), false)

console.log('builderCode tests passed')
