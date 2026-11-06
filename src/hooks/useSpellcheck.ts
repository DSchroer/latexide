import { useEffect, useRef, useState } from 'react'
import SpellWorker from '../workers/spell.worker?worker'

export type SpellLanguage = 'en' | 'de'

export type SpellIssue = {
  word: string
  start: number
  end: number
}

type WorkerMessage =
  | { type: 'result'; id: number; issues: SpellIssue[] }
  | { type: 'error'; id: number; message: string }

export function useSpellcheck(text: string | null, language: SpellLanguage, enabled: boolean): SpellIssue[] {
  const workerRef = useRef<Worker | null>(null)
  const requestId = useRef(0)
  const [issues, setIssues] = useState<SpellIssue[]>([])

  useEffect(() => {
    const worker = new SpellWorker()
    workerRef.current = worker
    const baseUrl = new URL(import.meta.env.BASE_URL, window.location.origin).href

    worker.onmessage = (event: MessageEvent<WorkerMessage>) => {
      const message = event.data
      if (message.id !== requestId.current) return
      if (message.type === 'result') setIssues(message.issues)
      else setIssues([])
    }

    worker.onerror = () => setIssues([])
    worker.postMessage({ type: 'init', baseUrl })

    return () => {
      worker.terminate()
      workerRef.current = null
    }
  }, [])

  useEffect(() => {
    if (!enabled || !text) {
      requestId.current += 1
      setIssues([])
      return
    }

    const id = requestId.current + 1
    requestId.current = id
    setIssues([])
    const timer = window.setTimeout(() => {
      workerRef.current?.postMessage({ type: 'check', id, text, language })
    }, 650)

    return () => window.clearTimeout(timer)
  }, [text, language, enabled])

  return issues
}
