import type { ProjectFile, VersionFile } from '../types'

const encoder = new TextEncoder()

function toBytes(input: string | ArrayBuffer | Uint8Array): Uint8Array {
  if (typeof input === 'string') return encoder.encode(input)
  if (input instanceof Uint8Array) return input
  return new Uint8Array(input)
}

function fallbackHex(bytes: Uint8Array): string {
  // Only used if Web Crypto is unavailable (for example, a very old or
  // non-secure browser context). It is a deterministic fallback, not SHA-256.
  let hash = 0x811c9dc5
  for (const byte of bytes) {
    hash ^= byte
    hash = Math.imul(hash, 0x01000193)
  }
  return `fnv-${(hash >>> 0).toString(16).padStart(8, '0')}`
}

export async function sha256Hex(input: string | ArrayBuffer | Uint8Array): Promise<string> {
  const bytes = toBytes(input)
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const digest = await crypto.subtle.digest('SHA-256', bytes)
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
  }
  return fallbackHex(bytes)
}

export async function hashFile(file: ProjectFile): Promise<string> {
  if (file.kind === 'text') return sha256Hex(file.text ?? '')
  return sha256Hex(file.data ?? new ArrayBuffer(0))
}

export async function hashManifest(mainFile: string, files: VersionFile[], folders: string[] = []): Promise<string> {
  return sha256Hex(
    JSON.stringify({
      mainFile,
      folders: [...folders].sort(),
      files: [...files]
        .sort((a, b) => a.path.localeCompare(b.path))
        .map((file) => [file.path, file.hash]),
    }),
  )
}

export function bytesForFile(file: ProjectFile): Uint8Array {
  if (file.kind === 'text') return encoder.encode(file.text ?? '')
  return new Uint8Array(file.data ?? new ArrayBuffer(0))
}
