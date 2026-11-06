import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { strToU8, zipSync } from 'fflate'
import type { editor as MonacoEditor } from 'monaco-editor'
import { createProject, db, ensureSeedProject, getUISetting, saveProject, setUISetting } from './db'
import { downloadBytes } from './lib/download'
import {
  basename,
  detectMainFile,
  extname,
  formatBytes,
  isImagePath,
  isTextPath,
  normalizePath,
  stripCommonRoot,
  uniquePath,
} from './lib/paths'
import type { Build, CompileFile, Diagnostic, Project, ProjectFile } from './types'
import { useCompiler } from './hooks/useCompiler'
import { FileTree } from './components/FileTree'
import { EditorPane } from './components/EditorPane'
import { PdfPreview } from './components/PdfPreview'
import { ProblemsPanel } from './components/ProblemsPanel'
import { PwaUpdate } from './components/PwaUpdate'
import ZipWorker from './workers/zip.worker?worker'

type ZipEntry = { path: string; data: ArrayBuffer }

const OFFLINE_CACHE = 'tex-engine-v1'
const PACK_IDS = [
  'writing', 'figures', 'boxes', 'review', 'science', 'tables-plus', 'references', 'drafting',
  'algorithms', 'journal-classes', 'beamer-themes', 'fonts-latinmodern', 'exams', 'symbols', 'opentype-fonts',
]

function unzipInWorker(buffer: ArrayBuffer): Promise<ZipEntry[]> {
  return new Promise((resolve, reject) => {
    const worker = new ZipWorker()
    worker.onmessage = (event: MessageEvent<{ type: 'done'; files: ZipEntry[] } | { type: 'error'; message: string }>) => {
      worker.terminate()
      if (event.data.type === 'done') resolve(event.data.files)
      else reject(new Error(event.data.message))
    }
    worker.onerror = (event) => {
      worker.terminate()
      reject(new Error(event.message || 'Could not unzip the file.'))
    }
    worker.postMessage({ type: 'unzip', buffer, skipBuildArtifacts: true }, [buffer])
  })
}

function safeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'project'
}

function ImageView({ file }: { file: ProjectFile }) {
  const [url, setUrl] = useState('')

  useEffect(() => {
    const mimes: Record<string, string> = {
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      gif: 'image/gif',
      webp: 'image/webp',
      bmp: 'image/bmp',
      avif: 'image/avif',
      svg: 'image/svg+xml',
      ico: 'image/x-icon',
    }
    const mime = mimes[extname(file.path)] ?? 'application/octet-stream'
    const blob = new Blob([file.data ?? new ArrayBuffer(0)], { type: mime })
    const next = URL.createObjectURL(blob)
    setUrl(next)
    return () => URL.revokeObjectURL(next)
  }, [file])

  return (
    <div className="image-preview">
      <img src={url} alt={file.path} />
      <div className="image-meta">{file.path} · {formatBytes(file.size)}</div>
    </div>
  )
}

function BinaryView({ file }: { file: ProjectFile }) {
  return (
    <div className="binary-preview">
      <div className="empty-mark">BIN</div>
      <p>{file.path}</p>
      <p className="muted">{formatBytes(file.size)}</p>
    </div>
  )
}

export default function App() {
  const [projects, setProjects] = useState<Project[]>([])
  const [projectId, setProjectId] = useState<string | null>(null)
  const [files, setFiles] = useState<Record<string, ProjectFile>>({})
  const [openPaths, setOpenPaths] = useState<string[]>([])
  const [activePath, setActivePath] = useState<string | null>(null)
  const [pdf, setPdf] = useState<ArrayBuffer | null>(null)
  const [savedBuild, setSavedBuild] = useState<Build | null>(null)
  const [resultProjectId, setResultProjectId] = useState<string | null>(null)
  const [showProblems, setShowProblems] = useState(false)
  const [mobileTab, setMobileTab] = useState<'files' | 'editor' | 'pdf'>('editor')
  const [toast, setToast] = useState<{ message: string; kind: 'info' | 'error' } | null>(null)
  const [online, setOnline] = useState(navigator.onLine)
  const [importing, setImporting] = useState(false)
  const [offlineState, setOfflineState] = useState<'unknown' | 'idle' | 'working' | 'ready'>('unknown')
  const [offlineProgress, setOfflineProgress] = useState({ done: 0, total: 0 })

  const filesRef = useRef(files)
  filesRef.current = files
  const projectIdRef = useRef(projectId)
  projectIdRef.current = projectId
  const resetOnNextCompile = useRef(false)
  const saveTimers = useRef<Record<string, number>>({})
  const editorRef = useRef<MonacoEditor.IStandaloneCodeEditor | null>(null)
  const zipInputRef = useRef<HTMLInputElement | null>(null)
  const imageInputRef = useRef<HTMLInputElement | null>(null)

  const project = useMemo(() => projects.find((item) => item.id === projectId) ?? null, [projects, projectId])

  const notify = useCallback((message: string, kind: 'info' | 'error' = 'info') => {
    setToast({ message, kind })
  }, [])

  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(null), 4500)
    return () => window.clearTimeout(timer)
  }, [toast])

  useEffect(() => {
    const onOnline = () => setOnline(true)
    const onOffline = () => setOnline(false)
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    return () => {
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
    }
  }, [])

  useEffect(() => {
    if (!('caches' in window)) {
      setOfflineState('idle')
      return
    }
    const wasmUrl = new URL(`${import.meta.env.BASE_URL}engine/tectonic_wasm.wasm`, window.location.origin).href
    void caches
      .open(OFFLINE_CACHE)
      .then((cache) => cache.match(wasmUrl))
      .then((hit) => setOfflineState(hit ? 'ready' : 'idle'))
      .catch(() => setOfflineState('idle'))
  }, [])

  const {
    state: compileState,
    status: compileStatus,
    diagnostics: compilerDiagnostics,
    log: compilerLog,
    unsupported,
    compile,
  } = useCompiler({
    onResult: async (result) => {
      const pid = projectIdRef.current
      if (!pid) return
      setResultProjectId(pid)
      if (result.pdf) {
        setPdf(result.pdf)
        const build: Build = {
          projectId: pid,
          pdf: result.pdf,
          log: result.log,
          diagnostics: result.diagnostics,
          status: result.status,
          compiledAt: Date.now(),
        }
        setSavedBuild(build)
        await db.builds.put(build)
      }
      if (result.diagnostics.some((item) => item.severity === 'error') || result.status === 'failed') {
        setShowProblems(true)
      }
    },
  })

  const loadProject = useCallback(async (next: Project) => {
    const list = await db.files.where('projectId').equals(next.id).toArray()
    const map: Record<string, ProjectFile> = {}
    for (const file of list) map[file.path] = file

    const lastFile = await getUISetting(`activeFile:${next.id}`)
    const initial =
      lastFile && map[lastFile]
        ? lastFile
        : next.mainFile && map[next.mainFile]
          ? next.mainFile
          : Object.keys(map)[0] ?? null

    const build = await db.builds.get(next.id)

    setProjectId(next.id)
    setFiles(map)
    setOpenPaths(initial ? [initial] : [])
    setActivePath(initial)
    setSavedBuild(build ?? null)
    setPdf(build?.pdf ?? null)
    setResultProjectId(null)
    setShowProblems(Boolean(build?.diagnostics.some((item) => item.severity === 'error')))
    resetOnNextCompile.current = true
    await setUISetting('activeProjectId', next.id)
  }, [])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const seed = await ensureSeedProject()
      const all = await db.projects.orderBy('updatedAt').reverse().toArray()
      if (cancelled) return
      setProjects(all)
      const activeId = await getUISetting('activeProjectId')
      const chosen = all.find((item) => item.id === activeId) ?? seed
      await loadProject(chosen)
    })()
    return () => {
      cancelled = true
    }
  }, [loadProject])

  useEffect(() => {
    if (projectId && activePath) void setUISetting(`activeFile:${projectId}`, activePath)
  }, [projectId, activePath])

  useEffect(() => {
    const flush = () => {
      for (const timer of Object.values(saveTimers.current)) window.clearTimeout(timer)
      saveTimers.current = {}
      const list = Object.values(filesRef.current)
      void Promise.all(list.map((file) => db.files.put(file)))
    }
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flush()
    }
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('pagehide', flush)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('pagehide', flush)
    }
  }, [])

  const queueSave = useCallback((file: ProjectFile) => {
    const key = `${file.projectId}:${file.path}`
    window.clearTimeout(saveTimers.current[key])
    saveTimers.current[key] = window.setTimeout(() => {
      void db.files.put(file)
      delete saveTimers.current[key]
    }, 300)
  }, [])

  const updateFileText = useCallback(
    (path: string, text: string) => {
      const current = filesRef.current[path]
      if (!current) return
      const updated: ProjectFile = {
        ...current,
        text,
        size: text.length,
        updatedAt: Date.now(),
      }
      filesRef.current = { ...filesRef.current, [path]: updated }
      setFiles((previous) => ({ ...previous, [path]: updated }))
      queueSave(updated)
    },
    [queueSave],
  )

  const openFile = useCallback((path: string) => {
    setOpenPaths((previous) => (previous.includes(path) ? previous : [...previous, path]))
    setActivePath(path)
    setMobileTab('editor')
  }, [])

  const closeTab = (path: string) => {
    setOpenPaths((previous) => {
      const next = previous.filter((item) => item !== path)
      setActivePath((current) => (current === path ? next[next.length - 1] ?? null : current))
      return next
    })
  }

  const createFile = async () => {
    if (!projectId) return
    const name = window.prompt('New file path', 'chapter.tex')
    if (!name) return
    const path = normalizePath(name)
    if (!path) return
    if (filesRef.current[path]) {
      notify('That file already exists.', 'error')
      return
    }
    const kind = isTextPath(path) || !extname(path) ? 'text' : 'binary'
    const file: ProjectFile = {
      projectId,
      path,
      kind,
      text: kind === 'text' ? '' : undefined,
      data: kind === 'binary' ? new ArrayBuffer(0) : undefined,
      size: 0,
      updatedAt: Date.now(),
    }
    await db.files.put(file)
    setFiles((previous) => ({ ...previous, [path]: file }))
    openFile(path)
  }

  const renameFile = async (oldPath: string) => {
    if (!project) return
    const next = window.prompt('Rename file', oldPath)
    if (!next) return
    const newPath = normalizePath(next)
    if (!newPath || newPath === oldPath) return
    if (filesRef.current[newPath]) {
      notify('A file with that name already exists.', 'error')
      return
    }

    const file = filesRef.current[oldPath]
    if (!file) return
    const updated: ProjectFile = { ...file, path: newPath, updatedAt: Date.now() }

    await db.transaction('rw', db.files, db.projects, async () => {
      await db.files.delete([project.id, oldPath])
      await db.files.put(updated)
      if (project.mainFile === oldPath) {
        await db.projects.update(project.id, { mainFile: newPath, updatedAt: Date.now() })
      }
    })

    setFiles((previous) => {
      const copy = { ...previous }
      delete copy[oldPath]
      copy[newPath] = updated
      return copy
    })
    setOpenPaths((previous) => previous.map((path) => (path === oldPath ? newPath : path)))
    setActivePath((current) => (current === oldPath ? newPath : current))
    resetOnNextCompile.current = true
    if (project.mainFile === oldPath) {
      setProjects((previous) => previous.map((item) => (item.id === project.id ? { ...item, mainFile: newPath } : item)))
    }
  }

  const deleteFile = async (path: string) => {
    if (!project) return
    if (!window.confirm(`Delete ${path}?`)) return

    await db.files.delete([project.id, path])
    const remaining = { ...filesRef.current }
    delete remaining[path]

    let nextMain = project.mainFile
    if (project.mainFile === path) {
      nextMain = Object.keys(remaining).find((item) => item.endsWith('.tex')) ?? ''
      await db.projects.update(project.id, { mainFile: nextMain, updatedAt: Date.now() })
      setProjects((previous) => previous.map((item) => (item.id === project.id ? { ...item, mainFile: nextMain } : item)))
    }

    setFiles(remaining)
    setOpenPaths((previous) => {
      const next = previous.filter((item) => item !== path)
      if (activePath === path) setActivePath(next[next.length - 1] ?? null)
      return next
    })
    resetOnNextCompile.current = true
  }

  const setMainFile = async (path: string) => {
    if (!project) return
    const updated = { ...project, mainFile: path, updatedAt: Date.now() }
    await saveProject(updated)
    setProjects((previous) => previous.map((item) => (item.id === updated.id ? updated : item)))
    notify(`${basename(path)} is now the main file.`)
  }

  const runCompile = useCallback(() => {
    if (!project) return
    if (!project.mainFile || !filesRef.current[project.mainFile]) {
      notify('Choose a main .tex file first.', 'error')
      return
    }

    const payload: CompileFile[] = Object.values(filesRef.current)
      .filter((file) => (file.kind === 'text' && typeof file.text === 'string') || (file.kind === 'binary' && file.data))
      .map((file) => {
        if (file.kind === 'text') {
          const text = file.text ?? ''
          return { path: file.path, kind: 'text', text }
        }
        return { path: file.path, kind: 'binary', data: file.data }
      })

    // The browser engine ships BibTeX, not Biber (Biber is Perl). Patch the
    // in-memory copy so a document written for Biber still compiles; the file
    // on disk / in the exported ZIP is left untouched.
    let usedBibtex = false
    for (const file of payload) {
      if (file.kind === 'text' && /backend\s*=\s*biber/i.test(file.text ?? '')) {
        file.text = (file.text ?? '').replace(/backend\s*=\s*biber/gi, 'backend=bibtex')
        usedBibtex = true
      }
    }

    compile(payload, project.mainFile, resetOnNextCompile.current)
    resetOnNextCompile.current = false
    setShowProblems(true)
    if (usedBibtex) {
      notify('Compiled with BibTeX. Your file still says backend=biber; the browser build uses a BibTeX copy.')
    }
  }, [compile, notify, project])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) return
      if (event.key === 'Enter') {
        event.preventDefault()
        runCompile()
      }
      if (event.key.toLowerCase() === 's') {
        event.preventDefault()
        void Promise.all(Object.values(filesRef.current).map((file) => db.files.put(file)))
        notify('Saved.')
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [notify, runCompile])

  const importZip = async (file: File) => {
    setImporting(true)
    try {
      const entries = await unzipInWorker(await file.arrayBuffer())
      const normalized = entries
        .map((entry) => ({ ...entry, path: normalizePath(entry.path) }))
        .filter((entry) => entry.path)

      const { paths: strippedPaths, root } = stripCommonRoot(normalized.map((entry) => entry.path))
      const byOriginal = new Map(normalized.map((entry) => [entry.path, entry.data]))
      const originalPaths = normalized.map((entry) => entry.path)
      const strippedData = strippedPaths.map((path, index) => ({
        path,
        data: byOriginal.get(originalPaths[index]) ?? new ArrayBuffer(0),
      }))

      const decoder = new TextDecoder('utf-8', { fatal: false })
      const textContents: Record<string, string> = {}
      for (const entry of strippedData) {
        if (isTextPath(entry.path)) {
          textContents[entry.path] = decoder.decode(new Uint8Array(entry.data)).replace(/^\uFEFF/, '')
        }
      }

      const records: Array<Omit<ProjectFile, 'projectId' | 'updatedAt'>> = strippedData.map((entry) => {
        const text = textContents[entry.path]
        return text !== undefined
          ? { path: entry.path, kind: 'text', text, size: text.length }
          : { path: entry.path, kind: 'binary', data: entry.data, size: entry.data.byteLength }
      })

      const name = file.name.replace(/\.zip$/i, '') || (root ? root : 'Imported project')
      const created = await createProject(name, records)
      const detectedMain = detectMainFile(records.map((record) => record.path), textContents)
      if (detectedMain && detectedMain !== created.mainFile) {
        await db.projects.update(created.id, { mainFile: detectedMain, updatedAt: Date.now() })
        created.mainFile = detectedMain
      }

      const all = await db.projects.orderBy('updatedAt').reverse().toArray()
      setProjects(all)
      await loadProject(created)
      notify(`Imported ${records.length} files${root ? ` from ${root}/` : ''}.`)
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Import failed.', 'error')
    } finally {
      setImporting(false)
    }
  }

  const uploadImages = async (fileList: FileList) => {
    if (!projectId) return
    const added: string[] = []

    for (const file of Array.from(fileList)) {
      const folder = 'IMAGES'
      const path = uniquePath(filesRef.current, `${folder}/${file.name}`)
      const data = await file.arrayBuffer()
      const record: ProjectFile = {
        projectId,
        path,
        kind: 'binary',
        data,
        size: data.byteLength,
        updatedAt: Date.now(),
      }
      await db.files.put(record)
      filesRef.current = { ...filesRef.current, [path]: record }
      setFiles((previous) => ({ ...previous, [path]: record }))
      added.push(path)
    }

    if (added.length > 0) {
      const active = activePath ? filesRef.current[activePath] : null
      if (active?.kind === 'text' && activePath?.endsWith('.tex')) {
        const snippet = added.map((path) => `\\includegraphics[width=\\linewidth]{${path}}`).join('\n')
        insertAtCursor(`\n${snippet}\n`)
      }
      notify(`Added ${added.length} image${added.length === 1 ? '' : 's'}.`)
    }
  }

  const insertAtCursor = (text: string) => {
    const editor = editorRef.current
    if (!editor) return
    const position = editor.getPosition()
    if (!position) return
    editor.executeEdits('latexide', [
      {
        range: {
          startLineNumber: position.lineNumber,
          startColumn: position.column,
          endLineNumber: position.lineNumber,
          endColumn: position.column,
        },
        text,
      },
    ])
    editor.focus()
  }

  const downloadZip = () => {
    if (!project) return
    const entries: Record<string, Uint8Array> = {}
    for (const file of Object.values(filesRef.current)) {
      entries[file.path] =
        file.kind === 'text'
          ? strToU8(file.text ?? '')
          : new Uint8Array(file.data ?? new ArrayBuffer(0))
    }
    const archive = zipSync(entries, { level: 6 })
    downloadBytes(archive, `${safeFilename(project.name)}.zip`, 'application/zip')
  }

  const downloadPdf = () => {
    if (!project || !pdf) return
    const name = basename(project.mainFile || 'main.tex').replace(/\.tex$/i, '')
    downloadBytes(pdf, `${safeFilename(name)}.pdf`, 'application/pdf')
  }

  const prepareOffline = async () => {
    if (!('caches' in window)) {
      notify('This browser does not expose the Cache API.', 'error')
      return
    }

    const base = import.meta.env.BASE_URL
    const urls = [
      `${base}engine/tectonic_wasm.wasm`,
      `${base}engine/tectonic-bundle.tar.gz`,
      `${base}tex-packs/index.json`,
      ...PACK_IDS.map((id) => `${base}tex-packs/pack-${id}.tar.gz`),
      `${base}tex-packs/thesis.tar.gz`,
    ]

    setOfflineState('working')
    setOfflineProgress({ done: 0, total: urls.length })

    try {
      const cache = await caches.open(OFFLINE_CACHE)
      let done = 0
      for (const url of urls) {
        const response = await fetch(url)
        if (response.ok) await cache.put(url, response)
        done += 1
        setOfflineProgress({ done, total: urls.length })
      }
      setOfflineState('ready')
      notify('Engine and packages cached for offline use.')
    } catch (error) {
      setOfflineState('idle')
      notify(error instanceof Error ? error.message : 'Could not cache the engine.', 'error')
    }
  }

  const createBlankProject = async () => {
    const text = '\\documentclass{article}\n\n\\begin{document}\n\n\\end{document}\n'
    const created = await createProject('Untitled project', [
      { path: 'main.tex', kind: 'text', text, size: text.length },
    ])
    const all = await db.projects.orderBy('updatedAt').reverse().toArray()
    setProjects(all)
    await loadProject(created)
  }

  const openDiagnostic = (file: string, line: number | null) => {
    const target =
      (file && files[file] ? file : null) ??
      Object.keys(files).find((path) => basename(path) === basename(file)) ??
      null
    if (!target) return
    openFile(target)
    if (line) {
      window.setTimeout(() => {
        const editor = editorRef.current
        if (!editor) return
        const model = editor.getModel()
        if (!model) return
        const safeLine = Math.min(Math.max(1, line), model.getLineCount())
        editor.setPosition({ lineNumber: safeLine, column: 1 })
        editor.revealLineInCenter(safeLine)
        editor.focus()
      }, 80)
    }
  }

  const activeFile = activePath ? files[activePath] ?? null : null
  const displayDiagnostics = resultProjectId === projectId && compilerDiagnostics.length > 0
    ? compilerDiagnostics
    : savedBuild?.diagnostics ?? []
  const displayLog = resultProjectId === projectId && compilerLog ? compilerLog : savedBuild?.log || ''
  const displayUnsupported = resultProjectId === projectId ? unsupported : []
  const isCompiling = compileState === 'loading' || compileState === 'compiling'
  const errorCount = displayDiagnostics.filter((item) => item.severity === 'error').length

  return (
    <div className="app-shell">
      <input
        ref={zipInputRef}
        type="file"
        accept=".zip,application/zip"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0]
          event.target.value = ''
          if (file) void importZip(file)
        }}
      />
      <input
        ref={imageInputRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(event) => {
          if (event.target.files?.length) void uploadImages(event.target.files)
          event.target.value = ''
        }}
      />

      <header className="toolbar">
        <div className="brand">
          <span className="brand-mark">λ</span>
          <span className="brand-name">LaTeX IDE</span>
        </div>

        <select
          className="project-select"
          value={projectId ?? ''}
          onChange={(event) => {
            const next = projects.find((item) => item.id === event.target.value)
            if (next) void loadProject(next)
          }}
          aria-label="Project"
        >
          {projects.map((item) => (
            <option key={item.id} value={item.id}>{item.name}</option>
          ))}
        </select>
        <button className="icon-button" onClick={() => void createBlankProject()} title="New project">+</button>

        <div className="toolbar-actions">
          <button className="small-button" onClick={() => zipInputRef.current?.click()} disabled={importing}>
            {importing ? 'Importing…' : 'Import ZIP'}
          </button>
          <button className="small-button" onClick={() => void createFile()} disabled={!projectId}>+ File</button>
          <button className="small-button" onClick={() => imageInputRef.current?.click()} disabled={!projectId}>+ Image</button>
          <button className="small-button" onClick={() => setShowProblems((value) => !value)}>
            Problems{errorCount > 0 ? ` (${errorCount})` : ''}
          </button>
          <button className="small-button" onClick={() => void prepareOffline()} disabled={offlineState === 'working'} title="Cache the TeX engine for offline use">
            {offlineState === 'working'
              ? `Caching ${offlineProgress.done}/${offlineProgress.total}`
              : offlineState === 'ready'
                ? 'Offline ✓'
                : 'Offline'}
          </button>
          <button className="primary-button" onClick={runCompile} disabled={isCompiling || !project?.mainFile}>
            {isCompiling ? 'Compiling…' : 'Compile'}
          </button>
          <button className="small-button" onClick={downloadZip} disabled={!project}>ZIP</button>
          <button className="small-button" onClick={downloadPdf} disabled={!pdf}>PDF</button>
        </div>

        <div className={`engine-status${compileState === 'error' ? ' is-error' : ''}${!online ? ' is-offline' : ''}`} title={compileStatus}>
          <span className="status-dot" />
          <span className="status-text">{!online ? `Offline · ${compileStatus}` : compileStatus}</span>
        </div>
      </header>

      <div className="mobile-tabs">
        <button className={mobileTab === 'files' ? 'is-active' : ''} onClick={() => setMobileTab('files')}>Files</button>
        <button className={mobileTab === 'editor' ? 'is-active' : ''} onClick={() => setMobileTab('editor')}>Editor</button>
        <button className={mobileTab === 'pdf' ? 'is-active' : ''} onClick={() => setMobileTab('pdf')}>PDF</button>
      </div>

      <main className={`main-grid mobile-${mobileTab}${showProblems ? ' with-problems' : ''}`}>
        <FileTree
          files={files}
          activePath={activePath}
          mainFile={project?.mainFile ?? ''}
          onOpen={openFile}
          onRename={(path) => void renameFile(path)}
          onDelete={(path) => void deleteFile(path)}
          onSetMain={(path) => void setMainFile(path)}
          onNewFile={() => void createFile()}
          onImportZip={() => zipInputRef.current?.click()}
        />

        <section className="editor-pane">
          <div className="tabs">
            {openPaths.length === 0 && <span className="tabs-empty">No file open</span>}
            {openPaths.map((path) => (
              <div key={path} className={`tab${activePath === path ? ' is-active' : ''}`}>
                <button className="tab-name" onClick={() => openFile(path)} title={path}>
                  {basename(path)}
                  {project?.mainFile === path ? ' ★' : ''}
                </button>
                <button className="tab-close" onClick={() => closeTab(path)} title="Close">✕</button>
              </div>
            ))}
          </div>
          <div className="editor-body">
            {!activeFile && (
              <div className="empty-editor">
                <div className="empty-mark">T<sub>E</sub>X</div>
                <h2>No file open</h2>
                <p>Choose a file from the sidebar, create a new one, or import a ZIP project.</p>
                <div className="empty-actions">
                  <button className="small-button" onClick={() => void createFile()}>Create a file</button>
                  <button className="small-button" onClick={() => zipInputRef.current?.click()}>Import a ZIP</button>
                </div>
              </div>
            )}
            {activeFile?.kind === 'text' && (
              <EditorPane
                path={activeFile.path}
                modelPath={`${projectId ?? 'project'}/${activeFile.path}`}
                value={activeFile.text ?? ''}
                onChange={(text) => updateFileText(activeFile.path, text)}
                onMount={(editor) => {
                  editorRef.current = editor
                }}
              />
            )}
            {activeFile?.kind === 'binary' && isImagePath(activeFile.path) && <ImageView file={activeFile} />}
            {activeFile?.kind === 'binary' && !isImagePath(activeFile.path) && <BinaryView file={activeFile} />}
          </div>
        </section>

        <PdfPreview data={pdf} onDownload={downloadPdf} />
      </main>

      {showProblems && (
        <ProblemsPanel
          diagnostics={displayDiagnostics}
          log={displayLog}
          unsupported={displayUnsupported}
          onOpen={openDiagnostic}
          onClose={() => setShowProblems(false)}
        />
      )}

      {toast && <div className={`toast toast-${toast.kind}`}>{toast.message}</div>}
      <PwaUpdate />
      {project && (
        <div className="sr-only" aria-live="polite">
          {project.name} · {Object.keys(files).length} files · {compileStatus}
        </div>
      )}
      {!projectId && <div className="loading-overlay">Loading project…</div>}
    </div>
  )
}
