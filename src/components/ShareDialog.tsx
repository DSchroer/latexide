import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Project } from '../types'
import { addCloudMember, getCloudProject, removeCloudMember } from '../lib/cloud'

type Props = {
  project: Project
  open: boolean
  onClose: () => void
}

export function ShareDialog({ project, open, onClose }: Props) {
  const { t } = useTranslation()
  const [members, setMembers] = useState<string[]>([])
  const [ownerEmail, setOwnerEmail] = useState('')
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open || !project.cloudId) return
    let cancelled = false
    setError(null)
    void getCloudProject(project.cloudId, project.role ?? 'owner')
      .then((cloud) => {
        if (cancelled) return
        setMembers(cloud.memberEmails)
        setOwnerEmail(cloud.ownerEmail)
      })
      .catch((reason) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason))
      })
    return () => {
      cancelled = true
    }
  }, [open, project.cloudId, project.role])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose, open])

  if (!open) return null

  const add = async () => {
    if (!project.cloudId || !email.trim()) return
    setBusy(true)
    setError(null)
    try {
      const cloud = await addCloudMember(project.cloudId, email)
      setMembers(cloud.memberEmails)
      setEmail('')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusy(false)
    }
  }

  const remove = async (member: string) => {
    if (!project.cloudId) return
    setBusy(true)
    setError(null)
    try {
      const cloud = await removeCloudMember(project.cloudId, member)
      setMembers(cloud.memberEmails)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div
        className="modal share-modal"
        role="dialog"
        aria-modal="true"
        aria-label={t('share.title')}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="modal-header">
          <div>
            <h2>{t('share.title')}</h2>
            <p className="modal-subtitle">{t('share.subtitle', { name: project.name })}</p>
          </div>
          <button className="icon-button" onClick={onClose} title={t('share.close')}>✕</button>
        </div>

        <div className="share-body">
          {!project.cloudId && <div className="empty-note">{t('share.notSynced')}</div>}

          {project.cloudId && (
            <>
              <div className="share-label">{t('share.owner')}</div>
              <div className="share-row">
                <span className="share-avatar">{ownerEmail.slice(0, 1).toUpperCase()}</span>
                <span className="share-email">{ownerEmail}</span>
                <span className="share-role">{t('share.ownerRole')}</span>
              </div>

              <div className="share-label">{t('share.editors')}</div>
              {members.length === 0 && <div className="empty-note">{t('share.noEditors')}</div>}
              {members.map((member) => (
                <div className="share-row" key={member}>
                  <span className="share-avatar">{member.slice(0, 1).toUpperCase()}</span>
                  <span className="share-email">{member}</span>
                  <button className="small-button" onClick={() => void remove(member)} disabled={busy}>
                    {t('share.remove')}
                  </button>
                </div>
              ))}

              <div className="share-add">
                <input
                  className="share-input"
                  type="email"
                  value={email}
                  placeholder={t('share.emailPlaceholder')}
                  onChange={(event) => setEmail(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') void add()
                  }}
                  disabled={busy}
                />
                <button className="small-button" onClick={() => void add()} disabled={busy || !email.trim()}>
                  {t('share.add')}
                </button>
              </div>
              <p className="share-hint">{t('share.hint')}</p>
            </>
          )}

          {error && <div className="auth-error">{error}</div>}
        </div>

        <div className="modal-footer">
          <span className="muted">{t('share.footer')}</span>
          <button className="small-button" onClick={onClose}>{t('share.close')}</button>
        </div>
      </div>
    </div>
  )
}
