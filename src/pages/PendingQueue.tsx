import { useState, useEffect, useCallback } from 'react'
import { listPending, removePending, type PendingReading } from '../db'

function formatDate(ts: number) {
  return new Date(ts).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export default function PendingQueue({ onBack }: { onBack: () => void }) {
  const [items, setItems] = useState<PendingReading[]>([])

  const load = useCallback(async () => {
    setItems(await listPending())
  }, [])

  useEffect(() => { void load() }, [load])

  async function discard(id: number) {
    await removePending(id)
    await load()
  }

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
        <h1 className="text-2xl font-bold">Queued Readings</h1>
        <p className="text-green-200 text-sm mt-0.5">
          {items.length === 0 ? 'All synced' : `${items.length} waiting to sync`}
        </p>
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
            {items.map(item => (
              <div key={item.id} className="bg-white rounded-xl shadow-sm p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-gray-900 truncate">{item.unitLabel}</p>
                    <p className="text-sm text-gray-500">#{item.meterNumber} · {item.billingPeriod}</p>
                    <p className="text-sm text-gray-700 mt-1">Reading: <span className="font-semibold">{item.currentValue}</span></p>
                    <p className="text-xs text-gray-400 mt-0.5">Queued {formatDate(item.queuedAt)}</p>
                    {item.failCount > 0 && (
                      <p className="text-xs text-red-500 mt-1">
                        Failed {item.failCount}× — {item.lastError}
                      </p>
                    )}
                  </div>
                  <div className="flex flex-col items-end gap-2 shrink-0">
                    {item.photoBase64 && (
                      <img src={item.photoBase64} alt="meter" className="w-14 h-14 rounded-lg object-cover" />
                    )}
                    <button
                      onClick={() => discard(item.id!)}
                      className="text-xs text-red-500 font-medium py-1 px-2 active:text-red-700"
                    >
                      Discard
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
