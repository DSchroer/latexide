import { useEffect, useRef, useState } from 'react'
import type { CompileFile, Diagnostic, WorkerResponse } from '../types'
import TexWorker from '../workers/tex.worker?worker'

export type CompileState = 'idle' | 'loading' | 'compiling' | 'error'

type UseCompilerOptions = {
  onResult: (result: { pdf?: ArrayBuffer; synctex?: ArrayBuffer; log: string; diagnostics: Diagnostic[]; status: string }) => void
}

export function useCompiler({ onResult }: UseCompilerOptions) {
  const workerRef = useRef<Worker | null>(null)
  const onResultRef = useRef(onResult)
  onResultRef.current = onResult

  const [state, setState] = useState<CompileState>('loading')
  const [statusKey, setStatusKey] = useState('status.starting')
  const [statusParams, setStatusParams] = useState<Record<string, string | number>>({})
  const [statusOverride, setStatusOverride] = useState<string | null>(null)
  const [diagnostics, setDiagnostics] = useState<Diagnostic[]>([])
  const [log, setLog] = useState('')
  const [unsupported, setUnsupported] = useState<string[]>([])

  useEffect(() => {
    const worker = new TexWorker()
    workerRef.current = worker

    const baseUrl = new URL(import.meta.env.BASE_URL, window.location.origin).href

    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const message = event.data
      if (message.type === 'ready') {
        setState('idle')
        setStatusKey('status.ready')
        setStatusParams({})
        setStatusOverride(null)
        return
      }
      if (message.type === 'status') {
        setStatusKey(message.key)
        setStatusParams(message.params ?? {})
        setStatusOverride(null)
        setState((previous) => (previous === 'error' ? previous : 'loading'))
        return
      }
      if (message.type === 'result') {
        if (message.pdf) {
          onResultRef.current({
            pdf: message.pdf,
            synctex: message.synctex,
            log: message.log,
            diagnostics: message.diagnostics,
            status: message.status,
          })
        }
        setDiagnostics(message.diagnostics)
        setLog(message.log)
        setUnsupported(message.unsupported)
        setState(message.pdf ? 'idle' : 'error')
        setStatusKey(message.pdf ? 'status.ready' : 'status.failed')
        setStatusParams({})
        setStatusOverride(null)
        return
      }
      if (message.type === 'error') {
        setState('error')
        setStatusKey('status.failed')
        setStatusParams({})
        setStatusOverride(message.message)
        if (message.log) setLog(message.log)
      }
    }

    worker.onerror = () => {
      setState('error')
      setStatusKey('status.workerCrashed')
      setStatusParams({})
      setStatusOverride(null)
    }

    worker.postMessage({ type: 'init', baseUrl })

    return () => {
      worker.terminate()
      workerRef.current = null
    }
  }, [])

  const compile = (files: CompileFile[], mainFile: string, reset = false) => {
    if (!workerRef.current || !mainFile) return
    setState('compiling')
    setStatusKey('status.compiling')
    setStatusParams({})
    setStatusOverride(null)
    workerRef.current.postMessage({ type: 'compile', files, mainFile, reset })
  }

  const resetEngine = () => {
    workerRef.current?.postMessage({ type: 'reset' })
    setState('loading')
    setStatusKey('status.restarting')
    setStatusParams({})
    setStatusOverride(null)
    const baseUrl = new URL(import.meta.env.BASE_URL, window.location.origin).href
    workerRef.current?.postMessage({ type: 'init', baseUrl })
  }

  return { state, statusKey, statusParams, statusOverride, diagnostics, log, unsupported, compile, resetEngine }
}
