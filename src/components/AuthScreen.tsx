import { useState } from 'react'
import { useTranslation } from 'react-i18next'

type Props = {
  onSignIn: () => Promise<void>
  onSendMagicLink: (email: string) => Promise<void>
  onCompleteMagicLink: (email: string) => Promise<void>
  error: string | null
  magicLinkSent: boolean
  needsLinkEmail: boolean
  initialEmail: string
}

export function AuthScreen({
  onSignIn,
  onSendMagicLink,
  onCompleteMagicLink,
  error,
  magicLinkSent,
  needsLinkEmail,
  initialEmail,
}: Props) {
  const { t } = useTranslation()
  const [busy, setBusy] = useState(false)
  const [email, setEmail] = useState(initialEmail)

  const run = async (action: () => Promise<void>) => {
    setBusy(true)
    try {
      await action()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="auth-screen">
      <div className="auth-card">
        <div className="auth-mark">λ</div>
        <h1>{t('auth.title')}</h1>
        <p>{t('auth.subtitle')}</p>

        {needsLinkEmail ? (
          <div className="auth-link-form">
            <p className="auth-link-prompt">{t('auth.linkEmailPrompt')}</p>
            <input
              className="auth-input"
              type="email"
              value={email}
              placeholder={t('auth.emailPlaceholder')}
              onChange={(event) => setEmail(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && email.trim()) {
                  void run(() => onCompleteMagicLink(email))
                }
              }}
              autoFocus
            />
            <button
              className="auth-google auth-submit"
              onClick={() => void run(() => onCompleteMagicLink(email))}
              disabled={busy || !email.trim()}
            >
              {busy ? t('auth.completing') : t('auth.complete')}
            </button>
          </div>
        ) : (
          <>
            <button className="auth-google" onClick={() => void run(onSignIn)} disabled={busy}>
              <span className="auth-google-mark">G</span>
              {busy ? t('auth.signingIn') : t('auth.google')}
            </button>

            <div className="auth-divider">
              <span>{t('auth.or')}</span>
            </div>

            <div className="auth-link-form">
              <input
                className="auth-input"
                type="email"
                value={email}
                placeholder={t('auth.emailPlaceholder')}
                onChange={(event) => setEmail(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && email.trim()) {
                    void run(() => onSendMagicLink(email))
                  }
                }}
              />
              <button
                className="auth-google auth-submit"
                onClick={() => void run(() => onSendMagicLink(email))}
                disabled={busy || !email.trim()}
              >
                {busy ? t('auth.sending') : t('auth.magicLink')}
              </button>
            </div>

            {magicLinkSent && <div className="auth-success">{t('auth.magicLinkSent')}</div>}
          </>
        )}

        {error && <div className="auth-error">{error}</div>}
        <p className="auth-note">{t('auth.note')}</p>
      </div>
    </div>
  )
}
