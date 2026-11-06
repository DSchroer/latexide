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
  const [status, setStatus] = useState('Starting engine…')
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
        setStatus('Ready')
        return
      }
      if (message.type === 'status') {
        setStatus(message.message)
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
        setStatus(message.pdf ? 'Ready' : 'Compilation failed')
        return
      }
      if (message.type === 'error') {
        setState('error')
        setStatus(message.message)
        if (message.log) setLog(message.log)
      }
    }

    worker.onerror = (event) => {
      setState('error')
      setStatus(event.message || 'The compile worker crashed.')
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
    setStatus('Compiling…')
    workerRef.current.postMessage({ type: 'compile', files, mainFile, reset })
  }

  const resetEngine = () => {
    workerRef.current?.postMessage({ type: 'reset' })
    setState('loading')
    setStatus('Restarting engine…')
    const baseUrl = new URL(import.meta.env.BASE_URL, window.location.origin).href
    workerRef.current?.postMessage({ type: 'init', baseUrl })
  }

  return { state, status, diagnostics, log, unsupported, compile, resetEngine }
}
