import type { User } from 'firebase/auth'
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore'
import {
  deleteObject,
  getBytes,
  getMetadata,
  listAll,
  ref as storageRef,
  uploadBytes,
} from 'firebase/storage'
import { cloudDb, cloudStorage } from '../firebase/config'
import { db, newId } from '../db'
import type { BlobRecord, Project, Version, VersionFile } from '../types'
import { loadVersions, materializeVersion } from './versioning'

export type CloudRole = 'owner' | 'editor'

export type CloudProject = {
  id: string
  ownerUid: string
  ownerEmail: string
  name: string
  mainFile: string
  memberEmails: string[]
  memberRoles: Record<string, 'editor'>
  currentVersionId: string
  revision: number
  size: number
  createdAt: number
  updatedAt: number
  role: CloudRole
}

const projectsRef = collection(cloudDb, 'projects')
const pendingCloudProjects = new Map<string, Promise<{ project: Project; created: boolean }>>()

function normalizeEmail(email: string | null | undefined): string {
  return (email ?? '').trim().toLowerCase()
}

function toMillis(value: unknown): number {
  if (typeof value === 'number') return value
  if (value && typeof value === 'object' && 'toMillis' in value) {
    return (value as { toMillis: () => number }).toMillis()
  }
  return 0
}

function projectDocRef(cloudId: string) {
  return doc(cloudDb, 'projects', cloudId)
}

function versionDocRef(cloudId: string, versionId: string) {
  return doc(cloudDb, 'projects', cloudId, 'versions', versionId)
}

function blobRef(cloudId: string, hash: string) {
  return storageRef(cloudStorage, `projects/${cloudId}/blobs/${hash}`)
}

function cloudProjectFromDoc(id: string, data: Record<string, unknown>, role: CloudRole): CloudProject {
  return {
    id,
    ownerUid: String(data.ownerUid ?? ''),
    ownerEmail: String(data.ownerEmail ?? ''),
    name: String(data.name ?? 'Untitled project'),
    mainFile: String(data.mainFile ?? ''),
    memberEmails: Array.isArray(data.memberEmails) ? data.memberEmails.map(String) : [],
    memberRoles: (data.memberRoles as Record<string, 'editor'>) ?? {},
    currentVersionId: String(data.currentVersionId ?? ''),
    revision: Number(data.revision ?? 0),
    size: Number(data.size ?? 0),
    createdAt: toMillis(data.createdAt),
    updatedAt: toMillis(data.updatedAt),
    role,
  }
}

export async function listCloudProjects(user: User): Promise<CloudProject[]> {
  const uid = user.uid
  const email = normalizeEmail(user.email)
  const found = new Map<string, CloudProject>()

  const owned = await getDocs(query(projectsRef, where('ownerUid', '==', uid), orderBy('updatedAt', 'desc')))
  for (const item of owned.docs) {
    found.set(item.id, cloudProjectFromDoc(item.id, item.data(), 'owner'))
  }

  if (email) {
    const shared = await getDocs(
      query(projectsRef, where('memberEmails', 'array-contains', email), orderBy('updatedAt', 'desc')),
    )
    for (const item of shared.docs) {
      if (!found.has(item.id)) {
        found.set(item.id, cloudProjectFromDoc(item.id, item.data(), 'editor'))
      }
    }
  }

  return [...found.values()]
}

export async function getCloudProject(cloudId: string, role: CloudRole = 'owner'): Promise<CloudProject> {
  const snap = await getDoc(projectDocRef(cloudId))
  if (!snap.exists()) throw new Error('The cloud project no longer exists.')
  return cloudProjectFromDoc(snap.id, snap.data() as Record<string, unknown>, role)
}

export async function renameCloudProject(cloudId: string, name: string): Promise<void> {
  await updateDoc(projectDocRef(cloudId), { name, updatedAt: Date.now() })
}

async function createLocalProjectForCloud(cloud: CloudProject): Promise<Project> {
  const existing = await db.projects.where('cloudId').equals(cloud.id).first()
  if (existing) {
    const updated: Project = {
      ...existing,
      name: cloud.name,
      mainFile: cloud.mainFile,
      cloudId: cloud.id,
      ownerUid: cloud.ownerUid,
      role: cloud.role,
      updatedAt: cloud.updatedAt || existing.updatedAt,
    }
    await db.projects.put(updated)
    return updated
  }

  const now = Date.now()
  const project: Project = {
    id: newId(),
    name: cloud.name,
    mainFile: cloud.mainFile,
    createdAt: cloud.createdAt || now,
    updatedAt: cloud.updatedAt || now,
    cloudId: cloud.id,
    ownerUid: cloud.ownerUid,
    role: cloud.role,
  }
  await db.projects.put(project)
  return project
}

export async function ensureCloudProject(
  project: Project,
  user: User,
): Promise<{ project: Project; created: boolean }> {
  if (project.cloudId) return { project, created: false }
  const pending = pendingCloudProjects.get(project.id)
  if (pending) return pending

  const fresh = await db.projects.get(project.id)
  if (fresh?.cloudId) return { project: fresh, created: false }

  const creating = (async () => {
    const projectRef = doc(projectsRef)
    const cloudId = projectRef.id
    const now = Date.now()
    const ownerEmail = normalizeEmail(user.email)

    await setDoc(projectRef, {
      ownerUid: user.uid,
      ownerEmail,
      name: project.name,
      mainFile: project.mainFile,
      memberEmails: [],
      memberRoles: {},
      currentVersionId: '',
      revision: 0,
      size: 0,
      createdAt: now,
      updatedAt: now,
    })

    const updated: Project = {
      ...project,
      cloudId,
      ownerUid: user.uid,
      role: 'owner',
      updatedAt: now,
    }
    await db.projects.put(updated)
    return { project: updated, created: true }
  })()

  pendingCloudProjects.set(project.id, creating)
  try {
    return await creating
  } finally {
    pendingCloudProjects.delete(project.id)
  }
}

async function uploadBlob(cloudId: string, file: VersionFile): Promise<void> {
  const target = blobRef(cloudId, file.hash)
  try {
    await getMetadata(target)
    return
  } catch (reason) {
    const code = (reason as { code?: string })?.code
    if (code !== 'storage/object-not-found') throw reason
  }

  const blob = await db.blobs.get(file.hash)
  if (!blob) return
  const bytes =
    blob.kind === 'text'
      ? new TextEncoder().encode(blob.text ?? '')
      : new Uint8Array(blob.data ?? new ArrayBuffer(0))
  await uploadBytes(target, bytes, { contentType: 'application/octet-stream' })
}

async function uploadVersion(cloudId: string, version: Version, user: User): Promise<void> {
  await Promise.all(version.files.map((file) => uploadBlob(cloudId, file)))
  await setDoc(
    versionDocRef(cloudId, version.id),
    {
      label: version.label,
      kind: version.kind,
      createdAt: version.createdAt,
      createdBy: user.uid,
      mainFile: version.mainFile,
      manifestHash: version.manifestHash,
      files: version.files,
      folders: version.folders ?? [],
      size: version.size,
    },
    { merge: true },
  )
}

async function updateCloudHead(cloudId: string, project: Project, version: Version): Promise<void> {
  const projectRef = projectDocRef(cloudId)
  const snap = await getDoc(projectRef)
  if (!snap.exists()) throw new Error('The cloud project no longer exists.')
  const revision = Number((snap.data() as { revision?: number }).revision ?? 0)
  await updateDoc(projectRef, {
    name: project.name,
    mainFile: project.mainFile,
    currentVersionId: version.id,
    revision: revision + 1,
    size: version.size,
    updatedAt: Date.now(),
  })
}

export async function syncAllVersions(project: Project, user: User): Promise<Project> {
  const { project: cloudProject } = await ensureCloudProject(project, user)
  const cloudId = cloudProject.cloudId
  if (!cloudId) return project

  const versions = await loadVersions(project.id)
  if (versions.length === 0) return cloudProject

  for (const version of [...versions].reverse()) {
    await uploadVersion(cloudId, version, user)
  }
  await updateCloudHead(cloudId, cloudProject, versions[0])
  return cloudProject
}

export async function syncVersionToCloud(
  project: Project,
  version: Version,
  user: User,
): Promise<Project> {
  const { project: cloudProject, created } = await ensureCloudProject(project, user)
  const cloudId = cloudProject.cloudId
  if (!cloudId) return project

  if (created) {
    const versions = await loadVersions(project.id)
    for (const item of [...versions].reverse()) {
      await uploadVersion(cloudId, item, user)
    }
    await updateCloudHead(cloudId, cloudProject, versions[0] ?? version)
  } else {
    await uploadVersion(cloudId, version, user)
    await updateCloudHead(cloudId, cloudProject, version)
  }

  return cloudProject
}

async function ensureLocalBlob(cloudId: string, file: VersionFile): Promise<void> {
  if (await db.blobs.get(file.hash)) return
  const bytes = await getBytes(blobRef(cloudId, file.hash))
  const record: BlobRecord =
    file.kind === 'text'
      ? {
          hash: file.hash,
          kind: 'text',
          text: new TextDecoder().decode(bytes),
          size: bytes.byteLength,
        }
      : {
          hash: file.hash,
          kind: 'binary',
          data: bytes,
          size: bytes.byteLength,
        }
  await db.blobs.put(record)
}

export async function pullCloudProject(cloud: CloudProject, localProjectId: string): Promise<Project> {
  const projectSnap = await getDoc(projectDocRef(cloud.id))
  if (!projectSnap.exists()) throw new Error('The cloud project no longer exists.')
  const data = projectSnap.data() as Record<string, unknown>
  const remote = cloudProjectFromDoc(cloud.id, data, cloud.role)

  const versionSnap = await getDocs(collection(cloudDb, 'projects', cloud.id, 'versions'))
  const versions: Version[] = []

  for (const item of versionSnap.docs) {
    const raw = item.data() as Record<string, unknown>
    const files: VersionFile[] = Array.isArray(raw.files) ? (raw.files as VersionFile[]) : []
    for (const file of files) await ensureLocalBlob(cloud.id, file)
    versions.push({
      id: item.id,
      projectId: localProjectId,
      createdAt: toMillis(raw.createdAt),
      label: String(raw.label ?? 'Cloud version'),
      kind: (raw.kind as Version['kind']) ?? 'auto',
      mainFile: String(raw.mainFile ?? remote.mainFile),
      manifestHash: String(raw.manifestHash ?? ''),
      files,
      folders: Array.isArray(raw.folders) ? raw.folders.map(String) : [],
      size: Number(raw.size ?? 0),
    })
  }

  if (versions.length > 0) {
    await db.versions.bulkPut(versions)
  }

  const current =
    versions.find((version) => version.id === remote.currentVersionId) ??
    [...versions].sort((a, b) => b.createdAt - a.createdAt)[0]

  if (current) {
    const files = await materializeVersion(localProjectId, current)
    await db.transaction('rw', db.files, db.folders, db.projects, async () => {
      await db.files.where('projectId').equals(localProjectId).delete()
      await db.folders.where('projectId').equals(localProjectId).delete()
      if (files.length) await db.files.bulkPut(files)
      if (current.folders?.length) {
        await db.folders.bulkPut(
          current.folders.map((path) => ({ projectId: localProjectId, path, createdAt: Date.now() })),
        )
      }
      await db.projects.update(localProjectId, {
        name: remote.name,
        mainFile: remote.mainFile || current.mainFile,
        cloudId: remote.id,
        ownerUid: remote.ownerUid,
        role: remote.role,
        updatedAt: remote.updatedAt || Date.now(),
      })
    })
  }

  return (await db.projects.get(localProjectId)) ?? {
    id: localProjectId,
    name: remote.name,
    mainFile: remote.mainFile,
    createdAt: remote.createdAt,
    updatedAt: remote.updatedAt,
    cloudId: remote.id,
    ownerUid: remote.ownerUid,
    role: remote.role,
  }
}

export async function deleteCloudProject(cloudId: string): Promise<void> {
  const bucket = storageRef(cloudStorage, `projects/${cloudId}/blobs`)
  try {
    const listing = await listAll(bucket)
    await Promise.all(listing.items.map((item) => deleteObject(item)))
  } catch {
    // The project may have no blobs, or the user may only be an editor.
  }

  const versionSnap = await getDocs(collection(cloudDb, 'projects', cloudId, 'versions'))
  if (!versionSnap.empty) {
    const batch = writeBatch(cloudDb)
    for (const item of versionSnap.docs) batch.delete(item.ref)
    await batch.commit()
  }
  await deleteDoc(projectDocRef(cloudId))
}

export async function addCloudMember(cloudId: string, email: string): Promise<CloudProject> {
  const normalized = normalizeEmail(email)
  if (!normalized.includes('@')) throw new Error('Enter a valid email address.')
  const project = await getCloudProject(cloudId)
  if (normalizeEmail(project.ownerEmail) === normalized) {
    throw new Error('The owner is already a member.')
  }
  const memberEmails = [...new Set([...project.memberEmails, normalized])]
  const memberRoles = { ...project.memberRoles, [normalized]: 'editor' as const }
  await updateDoc(projectDocRef(cloudId), {
    memberEmails,
    memberRoles,
    updatedAt: Date.now(),
  })
  return { ...project, memberEmails, memberRoles }
}

export async function removeCloudMember(cloudId: string, email: string): Promise<CloudProject> {
  const normalized = normalizeEmail(email)
  const project = await getCloudProject(cloudId)
  const memberEmails = project.memberEmails.filter((item) => item !== normalized)
  const memberRoles = { ...project.memberRoles }
  delete memberRoles[normalized]
  await updateDoc(projectDocRef(cloudId), {
    memberEmails,
    memberRoles,
    updatedAt: Date.now(),
  })
  return { ...project, memberEmails, memberRoles }
}

export async function syncAccountProjects(user: User): Promise<Project[]> {
  const cloudProjects = await listCloudProjects(user)

  for (const cloud of cloudProjects) {
    await createLocalProjectForCloud(cloud)
  }

  const locals = await db.projects.toArray()
  for (const local of locals) {
    if (local.cloudId) continue
    const { project } = await ensureCloudProject(local, user)
    await syncAllVersions(project, user)
  }

  return db.projects.orderBy('updatedAt').reverse().toArray()
}
