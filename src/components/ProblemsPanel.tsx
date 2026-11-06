import { useState } from 'react'
import type { Diagnostic } from '../types'
import { withLineNumbersForDisplay } from '../lib/paths'

type Props = {
  diagnostics: Diagnostic[]
  log: string
  unsupported: string[]
  onOpen: (file: string, line: number | null) => void
  onClose: () => void
}

export function ProblemsPanel({ diagnostics, log, unsupported, onOpen, onClose }: Props) {
  const [tab, setTab] = useState<'problems' | 'log'>('problems')
  const errors = diagnostics.filter((item) => item.severity === 'error').length
  const warnings = diagnostics.filter((item) => item.severity === 'warning').length

  return (
    <section className="problems-panel">
      <div className="problems-header">
        <div className="problems-tabs">
          <button className={tab === 'problems' ? 'is-active' : ''} onClick={() => setTab('problems')}>
            Problems {diagnostics.length > 0 && <span className="count">{diagnostics.length}</span>}
          </button>
          <button className={tab === 'log' ? 'is-active' : ''} onClick={() => setTab('log')}>Log</button>
          <span className="problems-summary">
            {errors > 0 && <span className="error-text">{errors} error{errors === 1 ? '' : 's'}</span>}
            {warnings > 0 && <span className="warning-text">{warnings} warning{warnings === 1 ? '' : 's'}</span>}
          </span>
        </div>
        <button className="icon-button" onClick={onClose} title="Hide panel">✕</button>
      </div>

      {tab === 'problems' ? (
        <div className="problems-body">
          {unsupported.length > 0 && (
            <div className="unsupported">
              Not available in the browser TeX bundle: <code>{unsupported.join(', ')}</code>
            </div>
          )}
          {diagnostics.length === 0 ? (
            <div className="empty-note">No problems reported. Compile to check the document.</div>
          ) : (
            diagnostics.map((diagnostic, index) => (
              <button
                key={`${diagnostic.file ?? 'doc'}-${diagnostic.line ?? 0}-${index}`}
                className={`diagnostic diagnostic-${diagnostic.severity}`}
                onClick={() => onOpen(diagnostic.file ?? '', diagnostic.line)}
              >
                <span className="diagnostic-severity">{diagnostic.severity === 'error' ? '✕' : diagnostic.severity === 'warning' ? '!' : 'i'}</span>
                <span className="diagnostic-location">{withLineNumbersForDisplay(diagnostic.file, diagnostic.line)}</span>
                <span className="diagnostic-message">{diagnostic.message}</span>
              </button>
            ))
          )}
        </div>
      ) : (
        <pre className="log-view">{log || 'No log yet.'}</pre>
      )}
    </section>
  )
}
