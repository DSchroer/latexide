import { useEffect, useMemo, useState } from 'react'
import { DiffEditor } from '@monaco-editor/react'
import { useTranslation } from 'react-i18next'
import type { ProjectFile, Version } from '../types'
import { materializeVersion } from '../lib/versioning'
import { basename, languageForPath } from '../lib/paths'

type Props = {
  projectId: string
  version: Version
  files: Record<string, ProjectFile>
  onClose: () => void
}

type Change = {
  path: string
  kind: 'added' | 'removed' | 'changed' | 'binary'
  before: string
  after: string
}

function sameBinary(a: ArrayBuffer | undefined, b: ArrayBuffer | undefined): boolean {
  if (!a || !b) return a === b
  if (a.byteLength !== b.byteLength) return false
  const left = new Uint8Array(a)
  const right = new Uint8Array(b)
  for (let i = 0; i < left.length; i += 1) {
    if (left[i] !== right[i]) return false
  }
  return true
}

export function DiffPanel({ projectId, version, files, onClose }: Props) {
  const { t } = useTranslation()
  const [changes, setChanges] = useState<Change[]>([])
  const [selected, setSelected] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void materializeVersion(projectId, version).then((oldFiles) => {
      if (cancelled) return
      const oldMap = new Map(oldFiles.map((file) => [file.path, file]))
      const currentMap = new Map(Object.values(files).map((file) => [file.path, file]))
      const paths = [...new Set([...oldMap.keys(), ...currentMap.keys()])].sort()
      const next: Change[] = []

      for (const path of paths) {
        const before = oldMap.get(path)
        const after = currentMap.get(path)
        if (!before) {
          next.push({ path, kind: 'added', before: '', after: after?.kind === 'text' ? after.text ?? '' : '' })
        } else if (!after) {
          next.push({ path, kind: 'removed', before: before.kind === 'text' ? before.text ?? '' : '', after: '' })
        } else if (before.kind === 'text' && after.kind === 'text') {
          if (before.text !== after.text) {
            next.push({ path, kind: 'changed', before: before.text ?? '', after: after.text ?? '' })
          }
        } else if (!sameBinary(before.data, after.data)) {
          next.push({ path, kind: 'binary', before: '', after: '' })
        }
      }

      setChanges(next)
      setSelected(next.find((change) => change.kind !== 'binary')?.path ?? next[0]?.path ?? null)
    })
    return () => {
      cancelled = true
    }
  }, [files, projectId, version])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  const active = useMemo(() => changes.find((change) => change.path === selected) ?? null, [changes, selected])

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div
        className="modal diff-modal"
        role="dialog"
        aria-modal="true"
        aria-label={t('history.diffTitle')}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="modal-header">
          <div>
            <h2>{t('history.diffTitle')}</h2>
            <p className="modal-subtitle">{version.label}</p>
          </div>
          <button className="icon-button" onClick={onClose} title={t('history.close')}>✕</button>
        </div>

        <div className="diff-body">
          <div className="diff-list">
            {changes.length === 0 && <div className="empty-note">{t('history.noChanges')}</div>}
            {changes.map((change) => (
              <button
                key={change.path}
                className={`diff-file${selected === change.path ? ' is-active' : ''}`}
                onClick={() => setSelected(change.path)}
              >
                <span className={`diff-mark mark-${change.kind}`}>
                  {change.kind === 'added' ? '+' : change.kind === 'removed' ? '−' : change.kind === 'binary' ? '•' : '±'}
                </span>
                <span className="diff-name" title={change.path}>{basename(change.path)}</span>
              </button>
            ))}
          </div>

          <div className="diff-editor">
            {!active && <div className="empty-note">{t('history.noChanges')}</div>}
            {active?.kind === 'binary' && <div className="empty-note">{t('history.binaryChange')}</div>}
            {active && active.kind !== 'binary' && (
              <DiffEditor
                original={active.before}
                modified={active.after}
                language={languageForPath(active.path)}
                theme="vs-dark"
                options={{
                  readOnly: true,
                  renderSideBySide: true,
                  minimap: { enabled: false },
                  scrollBeyondLastLine: false,
                  automaticLayout: true,
                  fontSize: 12,
                }}
              />
            )}
          </div>
        </div>

        <div className="modal-footer">
          <span className="muted">{t('history.compareHint')}</span>
          <button className="small-button" onClick={onClose}>{t('history.close')}</button>
        </div>
      </div>
    </div>
  )
}
