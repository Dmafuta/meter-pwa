import { useState, useEffect, useCallback } from 'react'
import { listPending, removePending, resetFailed, resetAllFailed, type PendingReading } from '../db'
import { syncPendingWithProgress, MAX_RETRIES } from '../sync'

function formatDate(ts: number) {
  return new Date(ts).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export default function PendingQueue({ onBack }: { onBack: () => void }) {
  const [items, setItems]       = useState<PendingReading[]>([])
  const [syncing, setSyncing]   = useState(false)
  const [syncingId, setSyncingId] = useState<number | null>(null)
  const lastSynced = localStorage.getItem('meter_last_synced')

  const load = useCallback(async () => {
    setItems(await listPending())
  }, [])

  useEffect(() => { void load() }, [load])

  async function discard(id: number) {
    await removePending(id)
    await load()
  }

  async function retry(id: number) {
    await resetFailed(id)
    await load()
    if (navigator.onLine) {
      setSyncing(true)
      await syncPendingWithProgress(
        (sid) => setSyncingId(sid),
        ()    => setSyncingId(null)
      )
      await load()
      setSyncing(false)
      setSyncingId(null)
    }
  }

  async function handleSync() {
    if (syncing || !navigator.onLine) return
    setSyncing(true)
    await syncPendingWithProgress(
      (id) => setSyncingId(id),
      ()   => setSyncingId(null)
    )
    await load()
    setSyncing(false)
    setSyncingId(null)
  }

  async function retryAllFailed() {
    if (syncing || !navigator.onLine) return
    await resetAllFailed()
    await load()
    setSyncing(true)
    await syncPendingWithProgress(
      (id) => setSyncingId(id),
      ()   => setSyncingId(null)
    )
    await load()
    setSyncing(false)
    setSyncingId(null)
  }

  const failed  = items.filter(i => (i.failCount ?? 0) > 0)
  const pending = items.filter(i => (i.failCount ?? 0) === 0)

  return (
    <div className="flex flex-col min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-green-600 text-white px-4 pt-12 pb-5">
        <button onClick={onBack} className="flex items-center gap-1 text-green-200 text-sm mb-2 active:text-white">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Back
        </button>
        <div className="flex items-end justify-between mt-1">
          <div>
            <h1 className="text-2xl font-bold">Queued Readings</h1>
            <p className="text-green-200 text-sm mt-0.5">
              {items.length === 0
                ? 'All synced'
                : `${pending.length} pending · ${failed.length} failed`}
            </p>
            {lastSynced && (
              <p className="text-green-300 text-xs mt-0.5">
                Last synced {new Date(lastSynced).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            {failed.length > 0 && !syncing && navigator.onLine && (
              <button
                onClick={() => void retryAllFailed()}
                className="text-xs font-semibold bg-white/15 text-white px-2.5 py-1.5 rounded-lg"
              >
                Retry failed ({failed.length})
              </button>
            )}
            {items.length > 0 && (
              <button
                onClick={() => void handleSync()}
                disabled={syncing || !navigator.onLine}
                className="text-sm font-semibold bg-white/20 text-white px-3 py-1.5 rounded-lg disabled:opacity-50"
              >
                {syncing ? 'Syncing…' : !navigator.onLine ? 'Offline' : 'Sync all'}
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="flex-1 px-4 py-4">
        {items.length === 0 ? (
          <div className="text-center py-16">
            <div className="text-5xl mb-4">✓</div>
            <p className="font-semibold text-gray-900">Nothing queued</p>
            <p className="text-sm text-gray-500 mt-1">All readings have been synced</p>
          </div>
        ) : (
          <div className="space-y-2">
            {items.map(item => {
              const isSyncing = syncingId === item.id
              const hasFailed = (item.failCount ?? 0) > 0
              const isStuck   = (item.failCount ?? 0) >= MAX_RETRIES

              return (
                <div
                  key={item.id}
                  className={`bg-white rounded-xl shadow-sm p-4 transition-opacity ${isSyncing ? 'opacity-60' : ''}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        {isSyncing && (
                          <div className="w-3.5 h-3.5 border-2 border-green-600 border-t-transparent rounded-full animate-spin shrink-0" />
                        )}
                        <p className="font-semibold text-gray-900 truncate">{item.unitLabel}</p>
                      </div>
                      <p className="text-sm text-gray-500">#{item.meterNumber} · {item.billingPeriod}</p>
                      <p className="text-sm text-gray-700 mt-1">
                        Reading: <span className="font-semibold">{item.currentValue}</span>
                        {item.tampered && <span className="ml-2 text-xs text-red-600 font-semibold">Tampered</span>}
                      </p>
                      <p className="text-xs text-gray-400 mt-0.5">Queued {formatDate(item.queuedAt)}</p>
                      {hasFailed && (
                        <div className="mt-1">
                          <p className={`text-xs font-semibold ${isStuck ? 'text-red-600' : 'text-orange-500'}`}>
                            {isStuck
                              ? `Stuck after ${item.failCount} attempts — ${item.lastError}`
                              : `Failed ${item.failCount}× — ${item.lastError}`}
                          </p>
                        </div>
                      )}
                      {isSyncing && (
                        <p className="text-xs text-green-600 mt-1 font-medium">Syncing now…</p>
                      )}
                    </div>
                    <div className="flex flex-col items-end gap-2 shrink-0">
                      {item.photoBase64 && (
                        <img src={item.photoBase64} alt="meter" className="w-14 h-14 rounded-lg object-cover" />
                      )}
                      {hasFailed && (
                        <button
                          onClick={() => void retry(item.id!)}
                          disabled={syncing}
                          className="text-xs text-indigo-600 font-semibold py-1 px-2 active:text-indigo-800 disabled:opacity-40"
                        >
                          Retry
                        </button>
                      )}
                      <button
                        onClick={() => void discard(item.id!)}
                        disabled={syncing}
                        className="text-xs text-red-500 font-medium py-1 px-2 active:text-red-700 disabled:opacity-40"
                      >
                        Discard
                      </button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
