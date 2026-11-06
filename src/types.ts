export type Project = {
  id: string
  name: string
  mainFile: string
  createdAt: number
  updatedAt: number
}

export type FileKind = 'text' | 'binary'

export type ProjectFile = {
  projectId: string
  path: string
  kind: FileKind
  text?: string
  data?: ArrayBuffer
  size: number
  updatedAt: number
}

export type Diagnostic = {
  severity: 'error' | 'warning' | 'info'
  file: string | null
  line: number | null
  message: string
  package?: string | null
}

export type Build = {
  projectId: string
  pdf?: ArrayBuffer
  log: string
  diagnostics: Diagnostic[]
  compiledAt: number
  status: string
}

export type UIState = {
  key: string
  value: string
}

export type CompileFile = {
  path: string
  kind: FileKind
  text?: string
  data?: ArrayBuffer
}

export type CompileResultMessage = {
  type: 'result'
  pdf?: ArrayBuffer
  synctex?: ArrayBuffer
  log: string
  diagnostics: Diagnostic[]
  status: string
  missingFiles: string[]
  unsupported: string[]
}

export type WorkerRequest =
  | { type: 'init'; baseUrl: string }
  | { type: 'compile'; files: CompileFile[]; mainFile: string; reset?: boolean }
  | { type: 'reset' }

export type WorkerResponse =
  | { type: 'ready' }
  | { type: 'status'; message: string }
  | CompileResultMessage
  | { type: 'error'; message: string; log?: string }
