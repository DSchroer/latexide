import Dexie, { type Table } from 'dexie'
import type { BlobRecord, Build, Project, ProjectFile, ProjectFolder, UIState, Version } from './types'

class LatexIDEDatabase extends Dexie {
  projects!: Table<Project, string>
  files!: Table<ProjectFile, [string, string]>
  builds!: Table<Build, string>
  ui!: Table<UIState, string>
  blobs!: Table<BlobRecord, string>
  versions!: Table<Version, string>
  folders!: Table<ProjectFolder, [string, string]>

  constructor() {
    super('latexide')
    this.version(1).stores({
      projects: 'id, updatedAt',
      files: '[projectId+path], projectId, path',
      builds: 'projectId',
      ui: 'key',
    })
    this.version(2).stores({
      blobs: 'hash',
      versions: 'id, projectId, createdAt',
    })
    this.version(3).stores({
      folders: '[projectId+path], projectId, path',
    })
    this.version(4).stores({
      projects: 'id, updatedAt, cloudId',
    })
  }
}

export const db = new LatexIDEDatabase()

export function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

export async function getUISetting(key: string): Promise<string | undefined> {
  return (await db.ui.get(key))?.value
}

export async function setUISetting(key: string, value: string): Promise<void> {
  await db.ui.put({ key, value })
}

export const SAMPLE_TEX = String.raw`\documentclass{article}
\usepackage{amsmath}

\begin{document}

\section{Hello, LaTeX}

This document is compiled entirely in your browser with a WebAssembly
Tectonic engine. Edit it, then press \textbf{Compile}.

\begin{equation}
  e^{i\pi} + 1 = 0
\end{equation}

\end{document}
`

export async function createProject(name: string, files: Array<Omit<ProjectFile, 'projectId' | 'updatedAt'>> = []): Promise<Project> {
  const now = Date.now()
  const project: Project = {
    id: newId(),
    name: name.trim() || 'Untitled project',
    mainFile: files.some((file) => file.path === 'main.tex') ? 'main.tex' : files.find((file) => file.path.endsWith('.tex'))?.path ?? '',
    createdAt: now,
    updatedAt: now,
  }

  const projectFiles: ProjectFile[] = files.map((file) => ({
    ...file,
    projectId: project.id,
    updatedAt: now,
  }))

  await db.transaction('rw', db.projects, db.files, async () => {
    await db.projects.put(project)
    if (projectFiles.length) await db.files.bulkPut(projectFiles)
  })

  return project
}

export async function ensureSeedProject(name = 'Welcome'): Promise<Project> {
  const existing = await db.projects.orderBy('updatedAt').last()
  if (existing) return existing

  return createProject(name, [
    {
      path: 'main.tex',
      kind: 'text',
      text: SAMPLE_TEX,
      size: SAMPLE_TEX.length,
    },
  ])
}

export async function saveProject(project: Project): Promise<void> {
  await db.projects.put({ ...project, updatedAt: Date.now() })
}

export async function clearLocalData(): Promise<void> {
  await db.transaction('rw', [db.projects, db.files, db.folders, db.builds, db.versions, db.blobs, db.ui], async () => {
    await Promise.all([
      db.projects.clear(),
      db.files.clear(),
      db.folders.clear(),
      db.builds.clear(),
      db.versions.clear(),
      db.blobs.clear(),
      db.ui.clear(),
    ])
  })
}
