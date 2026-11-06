import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import type { ProjectFile } from '../types'
import { basename, formatBytes, isImagePath, isTexPath } from '../lib/paths'

type TreeNode = {
  name: string
  path: string
  kind: 'folder' | 'file'
  children: TreeNode[]
}

type Props = {
  files: Record<string, ProjectFile>
  folders: string[]
  activePath: string | null
  mainFile: string
  onOpen: (path: string) => void
  onRename: (path: string) => void
  onDelete: (path: string) => void
  onSetMain: (path: string) => void
  onNewFile: () => void
  onNewFolder: () => void
  onNewFileInFolder: (folder: string) => void
  onDeleteFolder: (folder: string) => void
  onImportZip: () => void
}

function ensureFolder(root: TreeNode, path: string): void {
  const parts = path.split('/').filter(Boolean)
  let current = root
  for (let i = 0; i < parts.length; i += 1) {
    const name = parts[i]
    const folderPath = parts.slice(0, i + 1).join('/')
    let next = current.children.find((child) => child.name === name && child.kind === 'folder')
    if (!next) {
      next = { name, path: folderPath, kind: 'folder', children: [] }
      current.children.push(next)
    }
    current = next
  }
}

function buildTree(files: Record<string, ProjectFile>, folders: string[]): TreeNode[] {
  const root: TreeNode = { name: '', path: '', kind: 'folder', children: [] }

  for (const folder of folders) ensureFolder(root, folder)

  for (const file of Object.values(files)) {
    const parts = file.path.split('/')
    let current = root
    for (let i = 0; i < parts.length; i += 1) {
      const name = parts[i]
      const isLeaf = i === parts.length - 1
      const path = parts.slice(0, i + 1).join('/')
      let next = current.children.find((child) => child.name === name && child.kind === (isLeaf ? 'file' : 'folder'))
      if (!next) {
        next = { name, path, kind: isLeaf ? 'file' : 'folder', children: [] }
        current.children.push(next)
      }
      current = next
    }
  }

  const sort = (nodes: TreeNode[]): void => {
    nodes.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'folder' ? -1 : 1
      return a.name.localeCompare(b.name)
    })
    for (const node of nodes) sort(node.children)
  }
  sort(root.children)
  return root.children
}

function iconFor(path: string): string {
  if (isImagePath(path)) return '▧'
  if (isTexPath(path)) return 'T'
  if (path.endsWith('.bib')) return 'B'
  if (path.endsWith('.md')) return 'M'
  return '·'
}

export function FileTree({
  files,
  folders,
  activePath,
  mainFile,
  onOpen,
  onRename,
  onDelete,
  onSetMain,
  onNewFile,
  onNewFolder,
  onNewFileInFolder,
  onDeleteFolder,
  onImportZip,
}: Props) {
  const { t } = useTranslation()
  const tree = useMemo(() => buildTree(files, folders), [files, folders])

  const renderNode = (node: TreeNode, depth: number) => {
    if (node.kind === 'folder') {
      return (
        <div key={node.path}>
          <div className="tree-row tree-folder" style={{ paddingLeft: 8 + depth * 14 }}>
            <span className="tree-caret">▾</span>
            <span className="tree-icon">▸</span>
            <span className="tree-name" title={node.path}>{node.name}</span>
            <span className="tree-actions" onClick={(event) => event.stopPropagation()}>
              <button className="icon-button" title={t('files.newFileHere')} onClick={() => onNewFileInFolder(node.path)}>+</button>
              <button className="icon-button" title={t('files.deleteFolder')} onClick={() => onDeleteFolder(node.path)}>✕</button>
            </span>
          </div>
          {node.children.map((child) => renderNode(child, depth + 1))}
        </div>
      )
    }

    const file = files[node.path]
    if (!file) return null
    const isMain = node.path === mainFile

    return (
      <div
        key={node.path}
        className={`tree-row tree-file${activePath === node.path ? ' is-active' : ''}`}
        style={{ paddingLeft: 8 + depth * 14 }}
        onClick={() => onOpen(node.path)}
        role="button"
        tabIndex={0}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') onOpen(node.path)
        }}
      >
        <span className={`tree-icon file-icon ext-${node.path.split('.').pop()?.toLowerCase() ?? 'none'}`}>{iconFor(node.path)}</span>
        <span className="tree-name" title={`${node.path} · ${formatBytes(file.size)}`}>{basename(node.path)}</span>
        {isMain && <span className="main-badge" title={t('files.mainTitle')}>★</span>}
        <span className="tree-actions" onClick={(event) => event.stopPropagation()}>
          {isTexPath(node.path) && !isMain && (
            <button className="icon-button" title={t('files.setMain')} onClick={() => onSetMain(node.path)}>☆</button>
          )}
          <button className="icon-button" title={t('files.rename')} onClick={() => onRename(node.path)}>✎</button>
          <button className="icon-button" title={t('files.delete')} onClick={() => onDelete(node.path)}>✕</button>
        </span>
      </div>
    )
  }

  return (
    <aside className="sidebar">
      <div className="panel-heading">
        <span>{t('files.title')}</span>
        <span className="panel-count">{Object.keys(files).length}</span>
      </div>
      <div className="sidebar-actions">
        <button className="small-button" onClick={onNewFile}>{t('files.newFile')}</button>
        <button className="small-button" onClick={onNewFolder}>{t('files.newFolder')}</button>
        <button className="small-button" onClick={onImportZip}>{t('files.importZip')}</button>
      </div>
      <div className="tree" role="tree">
        {tree.length === 0 ? (
          <div className="empty-note">{t('files.empty')}</div>
        ) : (
          tree.map((node) => renderNode(node, 0))
        )}
      </div>
    </aside>
  )
}
