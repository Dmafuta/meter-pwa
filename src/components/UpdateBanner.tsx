import { useState, useEffect } from 'react'

/**
 * Shows a banner when a new service worker version is installed and waiting.
 * With VitePWA autoUpdate, the SW skips waiting automatically on next load —
 * this banner lets the user trigger the reload immediately.
 */
export default function UpdateBanner() {
  const [show, setShow] = useState(false)
  const [reloading, setReloading] = useState(false)

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return

    navigator.serviceWorker.getRegistration().then(reg => {
      if (!reg) return

      // Already a waiting SW on load (user reopened with queued update)
      if (reg.waiting && navigator.serviceWorker.controller) {
        setShow(true)
      }

      // New SW installed while page is open
      reg.addEventListener('updatefound', () => {
        const newWorker = reg.installing
        if (!newWorker) return
        newWorker.addEventListener('statechange', () => {
          if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
            setShow(true)
          }
        })
      })
    }).catch(() => {})

    // Controller changed → new SW took over → safe to reload
    const handleControllerChange = () => {
      if (reloading) window.location.reload()
    }
    navigator.serviceWorker.addEventListener('controllerchange', handleControllerChange)
    return () => navigator.serviceWorker.removeEventListener('controllerchange', handleControllerChange)
  }, [reloading])

  function handleTap() {
    setReloading(true)
    navigator.serviceWorker.getRegistration().then(reg => {
      if (reg?.waiting) {
        reg.waiting.postMessage({ type: 'SKIP_WAITING' })
      } else {
        window.location.reload()
      }
    }).catch(() => window.location.reload())
  }

  if (!show) return null

  return (
    <button
      onClick={handleTap}
      className="fixed top-0 left-0 right-0 z-50 w-full bg-blue-600 text-white py-2.5 px-4 text-sm font-medium text-center cursor-pointer border-0 hover:bg-blue-700 active:bg-blue-800 transition-colors"
    >
      {reloading ? 'Reloading…' : 'New version available — tap to update'}
    </button>
  )
}
