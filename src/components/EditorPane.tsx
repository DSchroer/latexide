import Editor, { type OnMount } from '@monaco-editor/react'
import { languageForPath } from '../lib/paths'

type Props = {
  path: string
  value: string
  onChange: (value: string) => void
  onMount: OnMount
}

export function EditorPane({ path, value, onChange, onMount }: Props) {
  return (
    <div className="editor-wrap">
      <Editor
        path={path}
        language={languageForPath(path)}
        value={value}
        onChange={(next) => onChange(next ?? '')}
        onMount={onMount}
        theme="vs-dark"
        loading={<div className="editor-loading">Loading editor…</div>}
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
