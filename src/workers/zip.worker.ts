/// <reference lib="webworker" />
import { unzipSync } from 'fflate'

type Incoming = { type: 'unzip'; buffer: ArrayBuffer; skipBuildArtifacts?: boolean }

type Outgoing =
  | { type: 'done'; files: { path: string; data: ArrayBuffer }[] }
  | { type: 'error'; message: string }

const ctx = self as unknown as DedicatedWorkerGlobalScope

const SKIP_SEGMENTS = new Set(['__MACOSX', '.DS_Store', 'Thumbs.db'])
const SKIP_EXTENSIONS = new Set([
  'aux', 'log', 'bcf', 'blg', 'toc', 'out', 'fls', 'fdb_latexmk', 'synctex', 'xdv',
])

function shouldSkip(path: string): boolean {
  const parts = path.split('/')
  if (parts.some((part) => SKIP_SEGMENTS.has(part))) return true
  if (path.endsWith('.synctex.gz')) return true
  const name = parts[parts.length - 1] ?? ''
  const dot = name.lastIndexOf('.')
  if (dot > 0 && SKIP_EXTENSIONS.has(name.slice(dot + 1).toLowerCase())) return true
  return false
}

ctx.onmessage = (event: MessageEvent<Incoming>) => {
  const { buffer, skipBuildArtifacts = true } = event.data
  try {
    const archive = new Uint8Array(buffer)
    const entries = unzipSync(archive, {
      filter: (file) => {
        if (!file.name || file.name.endsWith('/')) return false
        return !(skipBuildArtifacts && shouldSkip(file.name))
      },
    })

    const files: { path: string; data: ArrayBuffer }[] = []
    const transfers: ArrayBuffer[] = []
    for (const [path, bytes] of Object.entries(entries)) {
      const copy = bytes.slice()
      const data = copy.buffer
      files.push({ path, data })
      transfers.push(data)
    }

    const message: Outgoing = { type: 'done', files }
    ctx.postMessage(message, transfers)
  } catch (error) {
    const message: Outgoing = {
      type: 'error',
      message: error instanceof Error ? error.message : String(error),
    }
    ctx.postMessage(message)
  }
}
