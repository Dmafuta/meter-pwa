import { useState, useEffect } from 'react'
import { countPending } from '../db'
import { syncPending } from '../sync'

export default function OfflineBanner() {
  const [online, setOnline] = useState(navigator.onLine)
  const [pending, setPending] = useState(0)
  const [syncing, setSyncing] = useState(false)

  useEffect(() => {
    const go = () => setOnline(true)
    const off = () => setOnline(false)
    window.addEventListener('online', go)
    window.addEventListener('offline', off)
    return () => { window.removeEventListener('online', go); window.removeEventListener('offline', off) }
  }, [])

  // Refresh pending count whenever online status changes
  useEffect(() => {
    countPending().then(setPending)
  }, [online])

  // Auto-sync when coming back online
  useEffect(() => {
    if (online) { void sync() }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online])

  async function sync() {
    if (syncing) return
    setSyncing(true)
    const remaining = await syncPending()
    setPending(remaining)
    setSyncing(false)
  }

  if (!online) {
    return (
      <div className="fixed top-0 left-0 right-0 z-50 bg-orange-500 text-white text-sm text-center py-2 px-4">
        Offline — readings will be queued and synced when connected
      </div>
    )
  }

  if (pending > 0) {
    return (
      <div className="fixed top-0 left-0 right-0 z-50 bg-blue-600 text-white text-sm text-center py-2 px-4">
        {syncing
          ? `Syncing ${pending} queued reading${pending !== 1 ? 's' : ''}…`
          : (
            <>
              {pending} reading{pending !== 1 ? 's' : ''} pending sync{' '}
              <button onClick={() => void sync()} className="underline font-semibold ml-1">
                Sync now
              </button>
            </>
          )}
      </div>
    )
  }

  return null
}
