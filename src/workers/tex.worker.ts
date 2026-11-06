/// <reference lib="webworker" />
import {
  defaultPacks,
  EnginePoisonedError,
  parsePackIndex,
  resolveMissing,
  TexEngine,
  untar,
  type InstalledPack,
  type PackDefinition,
  type PackIndex,
} from 'glyphtex-engine'
import { gunzipSync } from 'fflate'
import type { CompileFile, Diagnostic, WorkerRequest, WorkerResponse } from '../types'

const ctx = self as unknown as DedicatedWorkerGlobalScope

let engine: TexEngine | null = null
let initPromise: Promise<void> | null = null
let baseUrl = ''
let packIndex: PackIndex | null = null
let installed: InstalledPack[] = []
const projectFiles = new Set<string>()

function post(message: WorkerResponse, transfer: Transferable[] = []): void {
  ctx.postMessage(message, transfer)
}

async function fetchBytes(path: string): Promise<Uint8Array> {
  const response = await fetch(new URL(path, baseUrl))
  if (!response.ok) throw new Error(`Could not load ${path} (${response.status})`)
  return new Uint8Array(await response.arrayBuffer())
}

function unpack(bytes: Uint8Array): Map<string, Uint8Array> {
  // Some static servers send `.tar.gz` with `Content-Encoding: gzip`; the
  // browser then hands us an already-decompressed tar. Sniff the magic bytes
  // instead of assuming the payload is still gzipped.
  const isGzip = bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b
  return untar(isGzip ? gunzipSync(bytes) : bytes)
}

async function loadPack(pack: PackDefinition, target: TexEngine): Promise<void> {
  const bytes = await fetchBytes(`tex-packs/pack-${pack.id}.tar.gz`)
  target.addFiles(unpack(bytes))
  installed.push({ id: pack.id, hash: pack.hash })
}

async function initialize(): Promise<void> {
  post({ type: 'status', message: 'Loading TeX engine…' })
  const wasm = await fetchBytes('engine/tectonic_wasm.wasm')
  const loaded = await TexEngine.load(wasm)

  post({ type: 'status', message: 'Loading TeX bundle…' })
  const bundleBytes = await fetchBytes('engine/tectonic-bundle.tar.gz')
  loaded.addFiles(unpack(bundleBytes))

  post({ type: 'status', message: 'Loading package index…' })
  const indexJson = JSON.parse(new TextDecoder().decode(await fetchBytes('tex-packs/index.json')))
  packIndex = parsePackIndex(indexJson)

  const packs = defaultPacks(packIndex)
  for (let i = 0; i < packs.length; i += 1) {
    post({ type: 'status', message: `Loading packages ${i + 1}/${packs.length}…` })
    await loadPack(packs[i], loaded)
  }

  // Optional project-specific pack. The thesis pack contains KOMA-Script,
  // biblatex-nature, and a few older packages that are not in GlyphTeX's
  // curated bundle.
  try {
    const custom = await fetch(new URL('tex-packs/thesis.tar.gz', baseUrl))
    if (custom.ok) {
      post({ type: 'status', message: 'Loading thesis package pack…' })
      loaded.addFiles(unpack(new Uint8Array(await custom.arrayBuffer())))
    }
  } catch {
    // The custom pack is optional.
  }

  engine = loaded
  projectFiles.clear()
  post({ type: 'ready' })
}

async function ensureReady(): Promise<void> {
  if (engine) return
  if (!initPromise) {
    initPromise = initialize().catch((error) => {
      initPromise = null
      engine = null
      throw error
    })
  }
  await initPromise
}

function toDiagnostics(result: ReturnType<TexEngine['compile']>): Diagnostic[] {
  return result.diagnostics.map((diagnostic) => ({
    severity: diagnostic.severity,
    file: diagnostic.file,
    line: diagnostic.line,
    message: diagnostic.message,
    package: diagnostic.package,
  }))
}

async function compile(files: CompileFile[], mainFile: string, reset = false): Promise<void> {
  await ensureReady()
  if (!engine) throw new Error('The TeX engine is not ready.')

  for (const path of projectFiles) engine.removeFile(path)
  projectFiles.clear()
  if (reset) engine.clearOutputs()

  for (const file of files) {
    if (file.kind === 'text' && typeof file.text === 'string') {
      engine.addFile(file.path, file.text)
      projectFiles.add(file.path)
    } else if (file.data) {
      engine.addFile(file.path, new Uint8Array(file.data))
      projectFiles.add(file.path)
    }
  }

  post({ type: 'status', message: 'Compiling…' })
  let result = engine.compile({
    entry: mainFile,
    maxPasses: 4,
    synctex: true,
    paper: 'a4',
  })

  let unsupported: string[] = []
  if (result.missingFiles.length > 0 && packIndex) {
    const resolution = resolveMissing(packIndex, result.missingFiles, installed)
    unsupported = resolution.unsupported
    if (resolution.packs.length > 0) {
      for (const pack of resolution.packs) {
        post({ type: 'status', message: `Loading ${pack.label}…` })
        await loadPack(pack, engine)
      }
      post({ type: 'status', message: 'Recompiling with additional packages…' })
      result = engine.compile({
        entry: mainFile,
        maxPasses: 4,
        synctex: true,
        paper: 'a4',
      })
      if (result.missingFiles.length > 0) {
        const second = resolveMissing(packIndex, result.missingFiles, installed)
        unsupported = second.unsupported
      }
    }
  }

  let pdf: ArrayBuffer | undefined
  const pdfBytes = engine.pdf()
  if (pdfBytes) {
    pdf = pdfBytes.buffer.slice(pdfBytes.byteOffset, pdfBytes.byteOffset + pdfBytes.byteLength)
  }

  let synctex: ArrayBuffer | undefined
  const syncOutput = result.outputs.find((output) => output.kind === 'synctex' || output.name.endsWith('.synctex.gz'))
  if (syncOutput) {
    const syncBytes = engine.output(syncOutput.name)
    if (syncBytes) {
      synctex = syncBytes.buffer.slice(syncBytes.byteOffset, syncBytes.byteOffset + syncBytes.byteLength)
    }
  }

  const transfers: Transferable[] = []
  if (pdf) transfers.push(pdf)
  if (synctex) transfers.push(synctex)

  post(
    {
      type: 'result',
      pdf,
      synctex,
      log: engine.log() ?? '',
      diagnostics: toDiagnostics(result),
      status: result.status,
      missingFiles: result.missingFiles,
      unsupported,
    },
    transfers,
  )
}

ctx.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const request = event.data

  if (request.type === 'init') {
    baseUrl = request.baseUrl
    try {
      await ensureReady()
    } catch (error) {
      post({ type: 'error', message: error instanceof Error ? error.message : String(error) })
    }
    return
  }

  if (request.type === 'reset') {
    engine = null
    initPromise = null
    installed = []
    projectFiles.clear()
    return
  }

  if (request.type === 'compile') {
    try {
      await compile(request.files, request.mainFile, request.reset)
    } catch (error) {
      if (error instanceof EnginePoisonedError) {
        engine = null
        initPromise = null
        installed = []
        projectFiles.clear()
        post({
          type: 'error',
          message: 'The TeX engine crashed and was reset. Press Compile again.',
        })
        return
      }
      post({
        type: 'error',
        message: error instanceof Error ? error.message : String(error),
        log: engine?.log(),
      })
    }
  }
}
