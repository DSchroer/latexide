import { useState } from 'react'
import { useTranslation } from 'react-i18next'

type Props = {
  onSignIn: () => Promise<void>
  error: string | null
}

export function AuthScreen({ onSignIn, error }: Props) {
  const { t } = useTranslation()
  const [busy, setBusy] = useState(false)

  const signIn = async () => {
    setBusy(true)
    try {
      await onSignIn()
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
        <button className="auth-google" onClick={() => void signIn()} disabled={busy}>
          <span className="auth-google-mark">G</span>
          {busy ? t('auth.signingIn') : t('auth.google')}
        </button>
        {error && <div className="auth-error">{error}</div>}
        <p className="auth-note">{t('auth.note')}</p>
      </div>
    </div>
  )
}
