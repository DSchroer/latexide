import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf'
import pdfWorkerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.js?url'

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl

type Props = {
  data: ArrayBuffer | null
  onDownload: () => void
}

type PdfPage = {
  getViewport: (options: { scale: number }) => { width: number; height: number }
  render: (options: { canvasContext: CanvasRenderingContext2D; viewport: unknown }) => {
    cancel: () => void
    promise: Promise<void>
  }
}

type PdfDoc = {
  numPages: number
  getPage: (page: number) => Promise<PdfPage>
  destroy: () => Promise<void>
}

type PageSize = {
  width: number
  height: number
}

type RenderState = {
  scale: number
  task: { cancel: () => void; promise: Promise<void> } | null
}

export function PdfPreview({ data, onDownload }: Props) {
  const { t } = useTranslation()
  const canvasRefs = useRef(new Map<number, HTMLCanvasElement>())
  const pageRefs = useRef(new Map<number, HTMLElement>())
  const renderedRef = useRef(new Map<number, RenderState>())
  const docRef = useRef<PdfDoc | null>(null)
  const sizesRef = useRef<PageSize[]>([])
  const scaleRef = useRef(1)
  const containerRef = useRef<HTMLDivElement | null>(null)

  const [doc, setDoc] = useState<PdfDoc | null>(null)
  const [sizes, setSizes] = useState<PageSize[]>([])
  const [page, setPage] = useState(1)
  const [zoom, setZoom] = useState(1)
  const [fitWidth, setFitWidth] = useState(true)
  const [containerWidth, setContainerWidth] = useState(0)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setDoc(null)
    setSizes([])
    setError(null)
    setPage(1)
    docRef.current = null
    sizesRef.current = []
    renderedRef.current.clear()

    if (!data) return

    const task = pdfjsLib.getDocument({
      data: new Uint8Array(data.slice(0)),
      isEvalSupported: false,
      useWorkerFetch: false,
    })

    task.promise.then(
      async (loaded) => {
        if (cancelled) {
          void loaded.destroy()
          return
        }
        const loadedSizes = await Promise.all(
          Array.from({ length: loaded.numPages }, (_, index) =>
            loaded.getPage(index + 1).then((pageProxy) => {
              const viewport = pageProxy.getViewport({ scale: 1 })
              return { width: viewport.width, height: viewport.height }
            }),
          ),
        )
        if (cancelled) return
        sizesRef.current = loadedSizes
        docRef.current = loaded as unknown as PdfDoc
        setSizes(loadedSizes)
        setDoc(loaded as unknown as PdfDoc)
        setPage(1)
        if (containerRef.current) containerRef.current.scrollTop = 0
      },
      (reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason))
      },
    )

    return () => {
      cancelled = true
      for (const state of renderedRef.current.values()) state.task?.cancel()
      renderedRef.current.clear()
      docRef.current = null
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

  const availableWidth = Math.max(240, containerWidth - 28)
  const baseWidth = sizes[0]?.width ?? 595
  const scale = fitWidth && containerWidth > 0 ? availableWidth / baseWidth : zoom
  scaleRef.current = scale

  useEffect(() => {
    for (const state of renderedRef.current.values()) state.task?.cancel()
    renderedRef.current.clear()
    for (const canvas of canvasRefs.current.values()) {
      canvas.width = 0
      canvas.height = 0
    }
  }, [scale, doc])

  const releasePage = useCallback((pageNumber: number) => {
    const state = renderedRef.current.get(pageNumber)
    if (state) {
      state.task?.cancel()
      renderedRef.current.delete(pageNumber)
    }
    const canvas = canvasRefs.current.get(pageNumber)
    if (canvas) {
      canvas.width = 0
      canvas.height = 0
    }
  }, [])

  const renderPage = useCallback(async (pageNumber: number) => {
    const currentDoc = docRef.current
    const canvas = canvasRefs.current.get(pageNumber)
    if (!currentDoc || !canvas) return

    const currentScale = scaleRef.current
    const existing = renderedRef.current.get(pageNumber)
    if (existing?.scale === currentScale) return
    existing?.task?.cancel()
    renderedRef.current.delete(pageNumber)

    const pageProxy = await currentDoc.getPage(pageNumber)
    if (!docRef.current || canvasRefs.current.get(pageNumber) !== canvas) return
    if (scaleRef.current !== currentScale) return

    const viewport = pageProxy.getViewport({ scale: currentScale })
    const ratio = Math.min(window.devicePixelRatio || 1, 2)
    canvas.width = Math.floor(viewport.width * ratio)
    canvas.height = Math.floor(viewport.height * ratio)
    const context = canvas.getContext('2d')
    if (!context) return
    context.setTransform(ratio, 0, 0, ratio, 0, 0)

    const task = pageProxy.render({ canvasContext: context, viewport })
    renderedRef.current.set(pageNumber, { scale: currentScale, task })

    try {
      await task.promise
    } catch (reason) {
      if ((reason as { name?: string })?.name !== 'RenderingCancelledException') {
        setError(reason instanceof Error ? reason.message : String(reason))
      }
    }
  }, [])

  useEffect(() => {
    const root = containerRef.current
    if (!root || !doc || sizes.length === 0) return

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const pageNumber = Number((entry.target as HTMLElement).dataset.page)
          if (!pageNumber) continue
          if (entry.isIntersecting) void renderPage(pageNumber)
          else releasePage(pageNumber)
        }
      },
      {
        root,
        rootMargin: '1200px 0px',
        threshold: 0.01,
      },
    )

    for (const element of pageRefs.current.values()) observer.observe(element)
    return () => observer.disconnect()
  }, [doc, releasePage, renderPage, sizes, scale])

  useEffect(() => {
    const root = containerRef.current
    if (!root || !doc || sizes.length === 0) return

    let frame = 0
    const onScroll = () => {
      if (frame) return
      frame = window.requestAnimationFrame(() => {
        frame = 0
        const rootTop = root.getBoundingClientRect().top
        const threshold = root.scrollTop + 60
        let current = 1
        for (const [pageNumber, element] of pageRefs.current) {
          const top = element.getBoundingClientRect().top - rootTop + root.scrollTop
          if (top <= threshold) current = Math.max(current, pageNumber)
        }
        setPage(current)
      })
    }

    root.addEventListener('scroll', onScroll, { passive: true })
    onScroll()
    return () => {
      root.removeEventListener('scroll', onScroll)
      if (frame) window.cancelAnimationFrame(frame)
    }
  }, [doc, sizes])

  const scrollToPage = useCallback((pageNumber: number) => {
    const root = containerRef.current
    const element = pageRefs.current.get(pageNumber)
    if (!root || !element) return
    const top = element.getBoundingClientRect().top - root.getBoundingClientRect().top + root.scrollTop - 10
    root.scrollTo({ top, behavior: 'auto' })
    setPage(pageNumber)
  }, [])

  const go = useCallback(
    (delta: number) => {
      if (!doc) return
      const next = Math.min(doc.numPages, Math.max(1, page + delta))
      scrollToPage(next)
    },
    [doc, page, scrollToPage],
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
              if (doc && next >= 1 && next <= doc.numPages) scrollToPage(next)
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
        {data && !error && (
          <div className="pdf-pages">
            {sizes.map((size, index) => {
              const pageNumber = index + 1
              const pageScale = scale
              return (
                <div
                  className="pdf-page-shell"
                  key={pageNumber}
                  data-page={pageNumber}
                  ref={(element) => {
                    if (element) pageRefs.current.set(pageNumber, element)
                    else pageRefs.current.delete(pageNumber)
                  }}
                >
                  <span className="pdf-page-label">{pageNumber}</span>
                  <div
                    className="pdf-page"
                    style={{
                      width: Math.max(1, Math.floor(size.width * pageScale)),
                      height: Math.max(1, Math.floor(size.height * pageScale)),
                    }}
                  >
                    <canvas
                      ref={(element) => {
                        if (element) canvasRefs.current.set(pageNumber, element)
                        else canvasRefs.current.delete(pageNumber)
                      }}
                    />
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </section>
  )
}
