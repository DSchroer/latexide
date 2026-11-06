import { useEffect, useState } from 'react'
import Editor, { type OnMount } from '@monaco-editor/react'
import { useTranslation } from 'react-i18next'
import type { editor as MonacoEditor } from 'monaco-editor'
import { monaco } from '../monaco/setup'
import type { SpellIssue } from '../hooks/useSpellcheck'
import { languageForPath } from '../lib/paths'

type Props = {
  path: string
  modelPath?: string
  value: string
  onChange: (value: string) => void
  onMount: OnMount
  spellcheckIssues: SpellIssue[]
  spellcheckEnabled: boolean
}

export function EditorPane({
  path,
  modelPath,
  value,
  onChange,
  onMount,
  spellcheckIssues,
  spellcheckEnabled,
}: Props) {
  const { t } = useTranslation()
  const [editor, setEditor] = useState<MonacoEditor.IStandaloneCodeEditor | null>(null)

  useEffect(() => {
    const model = editor?.getModel()
    if (!model) return

    if (!spellcheckEnabled) {
      monaco.editor.setModelMarkers(model, 'spellcheck', [])
      return
    }

    const markers = spellcheckIssues.map((issue) => {
      const start = model.getPositionAt(issue.start)
      const end = model.getPositionAt(issue.end)
      return {
        severity: monaco.MarkerSeverity.Warning,
        message: t('spellcheck.issue', { word: issue.word }),
        startLineNumber: start.lineNumber,
        startColumn: start.column,
        endLineNumber: end.lineNumber,
        endColumn: end.column,
        source: t('spellcheck.source'),
      }
    })

    monaco.editor.setModelMarkers(model, 'spellcheck', markers)
  }, [editor, path, spellcheckEnabled, spellcheckIssues, t])

  return (
    <div className="editor-wrap">
      <Editor
        path={modelPath ?? path}
        language={languageForPath(path)}
        value={value}
        onChange={(next) => onChange(next ?? '')}
        onMount={(instance) => {
          setEditor(instance)
          onMount(instance, monaco)
        }}
        theme="vs-dark"
        loading={<div className="editor-loading">{t('editor.loading')}</div>}
        options={{
          fontSize: 14,
          fontFamily: "'JetBrains Mono', 'SFMono-Regular', Consolas, monospace",
          minimap: { enabled: false },
          wordWrap: 'on',
          scrollBeyondLastLine: false,
          automaticLayout: true,
          renderLineHighlight: 'all',
          smoothScrolling: true,
          cursorBlinking: 'smooth',
          tabSize: 2,
          insertSpaces: true,
          renderWhitespace: 'selection',
          padding: { top: 12 },
          bracketPairColorization: { enabled: true },
        }}
      />
    </div>
  )
}
