import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Project, Version } from '../types'
import { loadVersions } from '../lib/versioning'
import { formatBytes } from '../lib/paths'

type Props = {
  project: Project
  open: boolean
  refreshKey: number
  onClose: () => void
  onRestore: (version: Version) => Promise<void>
  onCompare: (version: Version) => void
  onCheckpoint: () => Promise<void>
}

export function HistoryPanel({ project, open, refreshKey, onClose, onRestore, onCompare, onCheckpoint }: Props) {
  const { t, i18n } = useTranslation()
  const [versions, setVersions] = useState<Version[]>([])
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    void loadVersions(project.id).then((result) => {
      if (!cancelled) setVersions(result)
    })
    return () => {
      cancelled = true
    }
  }, [open, project.id, refreshKey])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose, open])

  if (!open) return null

  const restore = async (version: Version) => {
    setBusy(true)
    try {
      await onRestore(version)
    } finally {
      setBusy(false)
    }
  }

  const checkpoint = async () => {
    setBusy(true)
    try {
      await onCheckpoint()
    } finally {
      setBusy(false)
    }
  }

  const formatDate = (timestamp: number) =>
    new Date(timestamp).toLocaleString(i18n.resolvedLanguage || i18n.language)

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div
        className="modal history-modal"
        role="dialog"
        aria-modal="true"
        aria-label={t('history.title')}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="modal-header">
          <div>
            <h2>{t('history.title')}</h2>
            <p className="modal-subtitle">{t('history.subtitle', { name: project.name })}</p>
          </div>
          <div className="modal-actions">
            <button className="small-button" onClick={() => void checkpoint()} disabled={busy}>
              {t('history.checkpoint')}
            </button>
            <button className="icon-button" onClick={onClose} title={t('history.close')}>✕</button>
          </div>
        </div>

        <div className="history-list">
          {versions.length === 0 ? (
            <div className="empty-note">{t('history.empty')}</div>
          ) : (
            versions.map((version, index) => (
              <div className="history-row" key={version.id}>
                <div className="history-dot" />
                <div className="history-main">
                  <div className="history-title-line">
                    <span className="history-label">{version.label}</span>
                    {index === 0 && <span className="history-current">{t('history.current')}</span>}
                    <span className={`history-kind kind-${version.kind}`}>{t(`history.kind.${version.kind}`)}</span>
                  </div>
                  <div className="history-meta">
                    {formatDate(version.createdAt)} · {t('history.fileCount', { count: version.files.length })} · {formatBytes(version.size)}
                  </div>
                </div>
                <button className="small-button" onClick={() => onCompare(version)} disabled={busy}>
                  {t('history.compare')}
                </button>
                <button className="small-button" onClick={() => void restore(version)} disabled={busy}>
                  {t('history.restore')}
                </button>
              </div>
            ))
          )}
        </div>

        <div className="modal-footer">
          <span className="muted">{t('history.exportHint')}</span>
          <button className="small-button" onClick={onClose}>{t('history.close')}</button>
        </div>
      </div>
    </div>
  )
}
