import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf'
import pdfWorkerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.js?url'

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl

type Props = {
  data: ArrayBuffer | null
  onDownload: () => void
}

type PdfDoc = {
  numPages: number
  getPage: (page: number) => Promise<any>
  destroy: () => Promise<void>
}

export function PdfPreview({ data, onDownload }: Props) {
  const { t } = useTranslation()
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [doc, setDoc] = useState<PdfDoc | null>(null)
  const [page, setPage] = useState(1)
  const [zoom, setZoom] = useState(1)
  const [fitWidth, setFitWidth] = useState(true)
  const [containerWidth, setContainerWidth] = useState(0)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setDoc(null)
    setError(null)
    setPage(1)

    if (!data) return

    const task = pdfjsLib.getDocument({
      data: new Uint8Array(data.slice(0)),
      isEvalSupported: false,
      useWorkerFetch: false,
    })

    task.promise.then(
      (loaded) => {
        if (cancelled) {
          void loaded.destroy()
          return
        }
        setDoc(loaded as unknown as PdfDoc)
      },
      (reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason))
      },
    )

    return () => {
      cancelled = true
      void task.destroy()
    }
  }, [data])

  useLayoutEffect(() => {
    const element = containerRef.current
    if (!element) return
    const update = () => setContainerWidth(element.clientWidth)
    update()
    const observer = new ResizeObserver(update)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!doc) return
    let cancelled = false
    let renderTask: { cancel: () => void; promise: Promise<void> } | null = null

    const render = async () => {
      const loadedPage = await doc.getPage(page)
      if (cancelled) return
      const base = loadedPage.getViewport({ scale: 1 })
      const available = Math.max(220, containerWidth - 28)
      const scale = fitWidth && containerWidth > 0 ? available / base.width : zoom
      const viewport = loadedPage.getViewport({ scale })
      const canvas = canvasRef.current
      if (!canvas) return

      const ratio = Math.min(window.devicePixelRatio || 1, 2)
      canvas.width = Math.floor(viewport.width * ratio)
      canvas.height = Math.floor(viewport.height * ratio)
      canvas.style.width = `${Math.floor(viewport.width)}px`
      canvas.style.height = `${Math.floor(viewport.height)}px`

      const context = canvas.getContext('2d')
      if (!context) return
      context.setTransform(ratio, 0, 0, ratio, 0, 0)

      const task = loadedPage.render({ canvasContext: context, viewport })
      renderTask = task
      try {
        await task.promise
      } catch (reason) {
        if (!cancelled && (reason as { name?: string })?.name !== 'RenderingCancelledException') {
          setError(reason instanceof Error ? reason.message : String(reason))
        }
      }
    }

    void render()
    return () => {
      cancelled = true
      renderTask?.cancel()
    }
  }, [doc, page, zoom, fitWidth, containerWidth])

  const go = useCallback(
    (delta: number) => {
      if (!doc) return
      setPage((current) => Math.min(doc.numPages, Math.max(1, current + delta)))
    },
    [doc],
  )

  return (
    <section className="preview-pane">
      <div className="preview-toolbar">
        <div className="preview-title">
          {t('pdf.title')}
          {doc && <span className="muted"> · {t('pdf.pages', { count: doc.numPages })}</span>}
        </div>
        <div className="preview-controls">
          <button className="icon-button" onClick={() => go(-1)} disabled={!doc || page <= 1} title={t('pdf.previousPage')}>‹</button>
          <input
            className="page-input"
            type="number"
            min={1}
            max={doc?.numPages ?? 1}
            value={page}
            onChange={(event) => {
              const next = Number(event.target.value)
              if (doc && next >= 1 && next <= doc.numPages) setPage(next)
            }}
            disabled={!doc}
            aria-label={t('pdf.pageNumber')}
          />
          <button className="icon-button" onClick={() => go(1)} disabled={!doc || page >= (doc?.numPages ?? 1)} title={t('pdf.nextPage')}>›</button>
          <span className="divider" />
          <button
            className={`icon-button${fitWidth ? ' is-active' : ''}`}
            onClick={() => setFitWidth((value) => !value)}
            title={t('pdf.fitWidth')}
          >
            ↔
          </button>
          <button className="icon-button" onClick={() => { setFitWidth(false); setZoom((value) => Math.max(0.4, value - 0.15)) }} title={t('pdf.zoomOut')}>−</button>
          <span className="zoom-label">{fitWidth ? t('pdf.fit') : `${Math.round(zoom * 100)}%`}</span>
          <button className="icon-button" onClick={() => { setFitWidth(false); setZoom((value) => Math.min(3, value + 0.15)) }} title={t('pdf.zoomIn')}>+</button>
          <span className="divider" />
          <button className="small-button" onClick={onDownload} disabled={!data}>{t('pdf.download')}</button>
        </div>
      </div>
      <div className="preview-scroll" ref={containerRef}>
        {!data && <div className="preview-empty"><div className="empty-mark">PDF</div><p>{t('pdf.empty')}</p></div>}
        {error && <div className="preview-error">{error}</div>}
        {data && !error && <canvas ref={canvasRef} className="pdf-canvas" />}
      </div>
    </section>
  )
}
