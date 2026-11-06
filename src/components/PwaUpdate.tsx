import { useTranslation } from 'react-i18next'
import { useRegisterSW } from 'virtual:pwa-register/react'

export function PwaUpdate() {
  const { t } = useTranslation()
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW({ immediate: true })

  if (!needRefresh) return null

  return (
    <div className="pwa-update">
      <span>{t('pwa.updateAvailable')}</span>
      <button className="small-button" onClick={() => void updateServiceWorker(true)}>{t('pwa.reload')}</button>
    </div>
  )
}
