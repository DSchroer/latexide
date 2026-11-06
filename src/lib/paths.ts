const TEXT_EXTENSIONS = new Set([
  'tex', 'ltx', 'bib', 'cls', 'sty', 'def', 'bbx', 'cbx', 'lbx', 'bst', 'dtx', 'ins',
  'md', 'txt', 'json', 'yaml', 'yml', 'toml', 'csv', 'tsv', 'xml', 'html', 'htm',
  'css', 'js', 'ts', 'jsx', 'tsx', 'log', 'aux', 'toc', 'out', 'bcf', 'blg', 'lco',
  'cfg', 'fd', 'map', 'enc', 'ist', 'tikz', 'pgf', 'dat', 'svg', 'gitignore',
])

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'avif', 'svg', 'ico'])

export function extname(path: string): string {
  const name = basename(path)
  const dot = name.lastIndexOf('.')
  return dot <= 0 ? '' : name.slice(dot + 1).toLowerCase()
}

export function basename(path: string): string {
  const i = path.lastIndexOf('/')
  return i < 0 ? path : path.slice(i + 1)
}

export function dirname(path: string): string {
  const i = path.lastIndexOf('/')
  return i < 0 ? '' : path.slice(0, i)
}

export function normalizePath(input: string): string {
  const parts: string[] = []
  for (const part of input.replace(/\\/g, '/').replace(/^\/+/, '').split('/')) {
    if (!part || part === '.') continue
    if (part === '..') {
      parts.pop()
      continue
    }
    parts.push(part)
  }
  return parts.join('/')
}

export function isTextPath(path: string): boolean {
  return TEXT_EXTENSIONS.has(extname(path))
}

export function isImagePath(path: string): boolean {
  return IMAGE_EXTENSIONS.has(extname(path))
}

export function isTexPath(path: string): boolean {
  return ['tex', 'ltx', 'cls', 'sty'].includes(extname(path))
}

export function languageForPath(path: string): string {
  const ext = extname(path)
  if (ext === 'tex' || ext === 'ltx' || ext === 'cls' || ext === 'sty') return 'latex'
  if (ext === 'bib') return 'bibtex'
  if (ext === 'md') return 'markdown'
  if (ext === 'json') return 'json'
  if (ext === 'yaml' || ext === 'yml') return 'yaml'
  if (ext === 'xml' || ext === 'html' || ext === 'htm') return 'xml'
  if (ext === 'css') return 'css'
  if (ext === 'js' || ext === 'jsx') return 'javascript'
  if (ext === 'ts' || ext === 'tsx') return 'typescript'
  return 'plaintext'
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function uniquePath(existing: Record<string, unknown>, desired: string): string {
  if (!existing[desired]) return desired
  const dir = dirname(desired)
  const name = basename(desired)
  const dot = name.lastIndexOf('.')
  const stem = dot > 0 ? name.slice(0, dot) : name
  const ext = dot > 0 ? name.slice(dot) : ''
  let i = 2
  while (true) {
    const candidate = `${dir ? `${dir}/` : ''}${stem}-${i}${ext}`
    if (!existing[candidate]) return candidate
    i += 1
  }
}

export function detectMainFile(paths: string[], contents: Record<string, string> = {}): string {
  if (paths.includes('main.tex')) return 'main.tex'
  const texFiles = paths.filter((path) => path.toLowerCase().endsWith('.tex'))
  const withDocumentClass = texFiles.find((path) => (contents[path] ?? '').includes('\\documentclass'))
  if (withDocumentClass) return withDocumentClass
  return texFiles[0] ?? ''
}

export function stripCommonRoot(paths: string[]): { paths: string[]; root: string } {
  if (paths.length === 0) return { paths, root: '' }
  const first = paths[0].split('/')[0]
  if (!first || paths.some((path) => !path.startsWith(`${first}/`))) {
    return { paths, root: '' }
  }
  return {
    root: first,
    paths: paths.map((path) => path.slice(first.length + 1)),
  }
}

export function withLineNumbersForDisplay(path: string | null, line: number | null): string {
  const where = path ? basename(path) : 'document'
  return line ? `${where}:${line}` : where
}
