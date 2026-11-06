export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.rel = 'noopener'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000)
}

export function downloadBytes(bytes: Uint8Array | ArrayBuffer, filename: string, type = 'application/octet-stream'): void {
  const part = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  downloadBlob(new Blob([part], { type }), filename)
}
