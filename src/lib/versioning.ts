import { strToU8 } from 'fflate'
import { db, newId } from '../db'
import type {
  BlobRecord,
  HistoryArchive,
  Project,
  ProjectFile,
  Version,
  VersionFile,
  VersionKind,
} from '../types'
import { bytesForFile, hashFile, hashManifest } from './hash'

const MAX_AUTO_VERSIONS = 50

type PreparedFile = {
  file: ProjectFile
  hash: string
}

type HistoryEntry = {
  path: string
  data: ArrayBuffer
}

function blobFromFile(file: ProjectFile, hash: string): BlobRecord {
  return file.kind === 'text'
    ? { hash, kind: 'text', text: file.text ?? '', size: file.size }
    : { hash, kind: 'binary', data: file.data ?? new ArrayBuffer(0), size: file.size }
}

function bytesFromBlob(blob: BlobRecord): Uint8Array {
  if (blob.kind === 'text') return new TextEncoder().encode(blob.text ?? '')
  return new Uint8Array(blob.data ?? new ArrayBuffer(0))
}

export async function loadVersions(projectId: string): Promise<Version[]> {
  const versions = await db.versions.where('projectId').equals(projectId).toArray()
  return versions.sort((a, b) => b.createdAt - a.createdAt)
}

export async function getLatestVersion(projectId: string): Promise<Version | undefined> {
  return (await loadVersions(projectId))[0]
}

export async function createVersion(
  projectId: string,
  files: ProjectFile[],
  mainFile: string,
  kind: VersionKind,
  label: string,
): Promise<Version | null> {
  const prepared: PreparedFile[] = []
  for (const file of [...files].sort((a, b) => a.path.localeCompare(b.path))) {
    prepared.push({ file, hash: await hashFile(file) })
  }

  const manifest: VersionFile[] = prepared.map(({ file, hash }) => ({
    path: file.path,
    kind: file.kind,
    hash,
    size: file.size,
  }))

  const manifestHash = await hashManifest(mainFile, manifest)
  const latest = await getLatestVersion(projectId)
  if (kind === 'auto' && latest?.manifestHash === manifestHash) return null

  const version: Version = {
    id: newId(),
    projectId,
    createdAt: Date.now(),
    label,
    kind,
    mainFile,
    manifestHash,
    files: manifest,
    size: manifest.reduce((total, file) => total + file.size, 0),
  }

  await db.transaction('rw', db.blobs, db.versions, async () => {
    for (const { file, hash } of prepared) {
      if (!(await db.blobs.get(hash))) {
        await db.blobs.put(blobFromFile(file, hash))
      }
    }
    await db.versions.put(version)
  })

  await pruneAutoVersions(projectId)
  return version
}

export async function ensureInitialVersion(
  projectId: string,
  files: ProjectFile[],
  mainFile: string,
  label = 'Initial version',
): Promise<void> {
  const count = await db.versions.where('projectId').equals(projectId).count()
  if (count === 0) {
    await createVersion(projectId, files, mainFile, 'initial', label)
  }
}

export async function materializeVersion(projectId: string, version: Version): Promise<ProjectFile[]> {
  const files: ProjectFile[] = []

  for (const entry of version.files) {
    const blob = await db.blobs.get(entry.hash)
    if (!blob) continue
    files.push({
      projectId,
      path: entry.path,
      kind: entry.kind,
      text: blob.kind === 'text' ? blob.text ?? '' : undefined,
      data: blob.kind === 'binary' ? blob.data ?? new ArrayBuffer(0) : undefined,
      size: blob.size,
      updatedAt: Date.now(),
    })
  }

  return files
}

export async function restoreVersion(projectId: string, version: Version): Promise<ProjectFile[]> {
  const files = await materializeVersion(projectId, version)
  await db.transaction('rw', db.files, db.projects, async () => {
    await db.files.where('projectId').equals(projectId).delete()
    if (files.length) await db.files.bulkPut(files)
    await db.projects.update(projectId, {
      mainFile: version.mainFile,
      updatedAt: Date.now(),
    })
  })
  return files
}

export async function exportHistory(project: Project): Promise<Record<string, Uint8Array>> {
  const versions = await loadVersions(project.id)
  const hashes = new Set<string>()
  for (const version of versions) {
    for (const file of version.files) hashes.add(file.hash)
  }

  const entries: Record<string, Uint8Array> = {}
  for (const hash of hashes) {
    const blob = await db.blobs.get(hash)
    if (blob) entries[`.history/blobs/${hash}`] = bytesFromBlob(blob)
  }

  const archive: HistoryArchive = {
    format: 'latexide-history',
    version: 1,
    exportedAt: new Date().toISOString(),
    project: { name: project.name, mainFile: project.mainFile },
    versions,
  }

  entries['.history/versions.json'] = strToU8(JSON.stringify(archive, null, 2))
  return entries
}

export async function importHistory(
  projectId: string,
  entries: HistoryEntry[],
): Promise<{ imported: number; mainFile?: string }> {
  const versionsEntry = entries.find((entry) => entry.path === '.history/versions.json')
  if (!versionsEntry) return { imported: 0 }

  let archive: HistoryArchive
  try {
    archive = JSON.parse(new TextDecoder().decode(new Uint8Array(versionsEntry.data))) as HistoryArchive
  } catch {
    return { imported: 0 }
  }

  if (archive.format !== 'latexide-history' || !Array.isArray(archive.versions)) {
    return { imported: 0 }
  }

  const blobs = new Map<string, ArrayBuffer>()
  for (const entry of entries) {
    const match = /^\.history\/blobs\/([^/]+)$/.exec(entry.path)
    if (match) blobs.set(match[1], entry.data)
  }

  const blobsToStore: BlobRecord[] = []
  for (const version of archive.versions) {
    for (const file of version.files ?? []) {
      const data = blobs.get(file.hash)
      if (!data || blobsToStore.some((blob) => blob.hash === file.hash)) continue
      blobsToStore.push(
        file.kind === 'text'
          ? {
              hash: file.hash,
              kind: 'text',
              text: new TextDecoder().decode(new Uint8Array(data)),
              size: data.byteLength,
            }
          : {
              hash: file.hash,
              kind: 'binary',
              data,
              size: data.byteLength,
            },
      )
    }
  }

  const versionsToStore: Version[] = archive.versions.map((version) => ({
    ...version,
    id: newId(),
    projectId,
    files: Array.isArray(version.files) ? version.files : [],
  }))

  await db.transaction('rw', db.blobs, db.versions, async () => {
    if (blobsToStore.length) await db.blobs.bulkPut(blobsToStore)
    if (versionsToStore.length) await db.versions.bulkPut(versionsToStore)
  })

  return { imported: versionsToStore.length, mainFile: archive.project?.mainFile }
}

async function pruneAutoVersions(projectId: string): Promise<void> {
  const versions = await loadVersions(projectId)
  const automatic = versions.filter((version) => version.kind === 'auto')
  const remove = automatic.slice(MAX_AUTO_VERSIONS)
  if (remove.length === 0) return

  await db.versions.bulkDelete(remove.map((version) => version.id))
  await removeUnreferencedBlobs()
}

async function removeUnreferencedBlobs(): Promise<void> {
  const versions = await db.versions.toArray()
  const referenced = new Set<string>()
  for (const version of versions) {
    for (const file of version.files) referenced.add(file.hash)
  }

  const allHashes = await db.blobs.toCollection().primaryKeys()
  const unused = allHashes.filter((hash) => !referenced.has(hash))
  if (unused.length) await db.blobs.bulkDelete(unused)
}
