import { readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { join, relative, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  defaultPacks,
  parsePackIndex,
  TexEngine,
  unpackTarGz,
} from 'glyphtex-engine'

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..')
const thesisDir = join(root, '..', 'as_doc')
const engineDir = join(root, 'node_modules', 'glyphtex-engine', 'wasm')
const packsDir = join(engineDir, 'packs')

const asset = (...parts) => readFile(join(...parts))
const index = parsePackIndex(JSON.parse((await asset(packsDir, 'packs-index.json')).toString()))

console.log('Loading engine…')
const engine = await TexEngine.load(await asset(engineDir, 'tectonic_wasm.wasm'))
engine.addFiles(await unpackTarGz(await asset(engineDir, 'tectonic-bundle.tar.gz')))

for (const pack of defaultPacks(index)) {
  console.log('Loading pack', pack.id)
  engine.addFiles(await unpackTarGz(await asset(packsDir, `pack-${pack.id}.tar.gz`)))
}

const customPack = join(root, 'public', 'tex-packs', 'thesis.tar.gz')
engine.addFiles(await unpackTarGz(await readFile(customPack)))

const skip = new Set(['.git', '__MACOSX', 'node_modules'])
const skipFile = (name) =>
  name === '.DS_Store' ||
  name === 'main.pdf' ||
  /\.(aux|log|bcf|blg|toc|out|fls|fdb_latexmk|synctex\.gz|xdv)$/i.test(name)

async function collect(dir) {
  const files = new Map()
  for (const entry of await readdir(dir)) {
    if (skip.has(entry) || skipFile(entry)) continue
    const full = join(dir, entry)
    const info = await stat(full)
    if (info.isDirectory()) {
      for (const [name, data] of await collect(full)) files.set(name, data)
    } else {
      const name = relative(thesisDir, full).replaceAll('\\', '/')
      files.set(name, await readFile(full))
    }
  }
  return files
}

const files = await collect(thesisDir)
const main = files.get('main.tex')
if (!main) throw new Error('main.tex not found')
const patched = main.toString().replace('backend=biber', 'backend=bibtex')
files.set('main.tex', Buffer.from(patched))

for (const [name, data] of files) engine.addFile(name, new Uint8Array(data))
console.log(`Added ${files.size} project files`)

console.log('Compiling…')
const result = engine.compile({ entry: 'main.tex', maxPasses: 4, synctex: true, paper: 'a4' })
console.log('status:', result.status)
console.log('passes:', result.passesRun)
console.log('missing:', result.missingFiles.slice(0, 30))
console.log('diagnostics:', result.diagnostics.filter((d) => d.severity === 'error').slice(0, 20))
const pdf = engine.pdf()
if (pdf) {
  await writeFile('/tmp/thesis-test.pdf', pdf)
  console.log('wrote /tmp/thesis-test.pdf', pdf.byteLength)
} else {
  console.log(engine.log()?.slice(-4000))
  process.exitCode = 1
}
