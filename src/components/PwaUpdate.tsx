import { useRegisterSW } from 'virtual:pwa-register/react'

export function PwaUpdate() {
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW({ immediate: true })

  if (!needRefresh) return null

  return (
    <div className="pwa-update">
      <span>A new version is available.</span>
      <button className="small-button" onClick={() => void updateServiceWorker(true)}>Reload</button>
    </div>
  )
}
