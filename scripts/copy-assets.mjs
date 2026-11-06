import { copyFile, mkdir, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const source = join(root, 'node_modules', 'glyphtex-engine', 'wasm')
const engineDir = join(root, 'public', 'engine')
const packsDir = join(root, 'public', 'tex-packs')

async function exists(path) {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

async function copyIfNeeded(from, to) {
  if (await exists(to)) {
    const [a, b] = await Promise.all([stat(from), stat(to)])
    if (a.size === b.size) return
  }
  await copyFile(from, to)
}

await mkdir(engineDir, { recursive: true })
await mkdir(packsDir, { recursive: true })

await copyIfNeeded(join(source, 'tectonic_wasm.wasm'), join(engineDir, 'tectonic_wasm.wasm'))
await copyIfNeeded(join(source, 'tectonic-bundle.tar.gz'), join(engineDir, 'tectonic-bundle.tar.gz'))
await copyIfNeeded(join(source, 'packs', 'packs-index.json'), join(packsDir, 'index.json'))

const { readdir } = await import('node:fs/promises')
for (const entry of await readdir(join(source, 'packs'))) {
  if (entry.endsWith('.tar.gz')) {
    await copyIfNeeded(join(source, 'packs', entry), join(packsDir, entry))
  }
}

console.log('TeX assets copied to public/engine and public/tex-packs')
