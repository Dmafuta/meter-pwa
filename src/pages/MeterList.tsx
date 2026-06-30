import { useState, useEffect, useCallback } from 'react'
import { getUnreadMeters, getReadMeters, type UnreadMeter, type ReadMeter } from '../api'
import { countPending } from '../db'

const UTILITY_BADGE: Record<string, string> = {
  water:       'bg-blue-100 text-blue-700',
  water_sewer: 'bg-cyan-100 text-cyan-700',
  electricity: 'bg-yellow-100 text-yellow-700',
  gas:         'bg-orange-100 text-orange-700',
}

function formatPeriod(p: string): string {
  const [year, month] = p.split('-')
  return new Date(parseInt(year), parseInt(month) - 1, 1)
    .toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
}

export default function MeterList({
  period,
  refreshKey,
  onMeterSelect,
  onChangePeriod,
  onShowQueue,
  onRegister,
  onLogout
}: {
  period: string
  refreshKey: number
  onMeterSelect: (m: UnreadMeter) => void
  onChangePeriod: () => void
  onShowQueue: () => void
  onRegister: () => void
  onLogout: () => void
}) {
  const [meters, setMeters] = useState<UnreadMeter[]>([])
  const [readMeters, setReadMeters] = useState<ReadMeter[]>([])
  const [showRead, setShowRead] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [pending, setPending] = useState(0)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [unread, read] = await Promise.all([
        getUnreadMeters(period),
        getReadMeters(period)
      ])
      setMeters(unread)
      setReadMeters(read)
    } catch (e: unknown) {
      const status = (e as { status?: number }).status
      if (status === 403) {
        setError('Your account does not have permission to view meters. Contact your administrator.')
      } else if (status === 401) {
        setError('Session expired. Please sign in again.')
      } else {
        setError('Could not load meters. Check your connection and try again.')
      }
    } finally {
      setLoading(false)
    }
    setPending(await countPending())
  }, [period])

  useEffect(() => { void load() }, [load, refreshKey])

  return (
    <div className="flex flex-col min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-green-600 text-white px-4 pt-12 pb-5 safe-top">
        <div className="flex items-center justify-between mb-2">
          <button
            onClick={onChangePeriod}
            className="flex items-center gap-1 text-green-200 text-sm active:text-white"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            {formatPeriod(period)}
          </button>
          <div className="flex items-center gap-3">
            <button onClick={onRegister} className="text-green-200 active:text-white" title="Register new meter">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
            </button>
            <button onClick={onShowQueue} className="relative text-green-200 active:text-white">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0H4" />
              </svg>
              {pending > 0 && (
                <span className="absolute -top-1 -right-1 w-4 h-4 bg-orange-400 rounded-full text-xs flex items-center justify-center font-bold text-white leading-none">
                  {pending > 9 ? '9+' : pending}
                </span>
              )}
            </button>
            <button onClick={onLogout} className="text-green-200 text-sm active:text-white">
              Sign out
            </button>
          </div>
        </div>
        <h1 className="text-2xl font-bold">Meter Readings</h1>
        {!loading && (
          <div className="flex items-center gap-3 mt-1">
            <p className="text-green-200 text-sm">
              {meters.length} unread · {readMeters.length} read
            </p>
            {(meters.length + readMeters.length) > 0 && (
              <div className="flex-1 bg-white/20 rounded-full h-1.5 max-w-[120px]">
                <div
                  className="bg-white rounded-full h-1.5 transition-all"
                  style={{ width: `${Math.round(readMeters.length / (meters.length + readMeters.length) * 100)}%` }}
                />
              </div>
            )}
          </div>
        )}
      </div>

      {/* Body */}
      <div className="flex-1 px-4 py-4 overflow-y-auto">
        {loading ? (
          <div className="flex justify-center py-16">
            <div className="w-8 h-8 border-2 border-green-600 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : error ? (
          <div className="text-center py-12">
            <p className="text-gray-500 mb-3">{error}</p>
            <button onClick={() => void load()} className="text-green-600 font-medium">Retry</button>
          </div>
        ) : meters.length === 0 ? (
          <div className="text-center py-16">
            <div className="text-5xl mb-4">✓</div>
            <p className="font-semibold text-gray-900 text-lg">All meters read!</p>
            <p className="text-sm text-gray-500 mt-1">No unread meters for {formatPeriod(period)}</p>
          </div>
        ) : (
          <div className="space-y-2">
            {meters.map(m => (
              <button
                key={m.id}
                onClick={() => onMeterSelect(m)}
                className="w-full bg-white rounded-xl shadow-sm p-4 text-left active:bg-gray-50 flex items-center gap-3"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-semibold text-gray-900 truncate">{m.unit_label}</span>
                    <span className={`shrink-0 text-xs px-2 py-0.5 rounded-full font-medium ${UTILITY_BADGE[m.utility_type] ?? 'bg-gray-100 text-gray-600'}`}>
                      {m.utility_type.replace('_', ' ')}
                    </span>
                  </div>
                  <p className="text-sm text-gray-500 truncate">
                    #{m.meter_number} · Prev: {m.last_reading ?? '—'}
                  </p>
                </div>
                <svg className="w-5 h-5 text-gray-300 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </button>
            ))}

            {/* Already read section */}
            {readMeters.length > 0 && (
              <div className="pt-2">
                <button
                  onClick={() => setShowRead(v => !v)}
                  className="flex items-center gap-2 text-sm font-medium text-gray-400 py-2 w-full"
                >
                  <svg className={`w-4 h-4 transition-transform ${showRead ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                  {readMeters.length} already read this period
                </button>
                {showRead && (
                  <div className="space-y-2 mt-1">
                    {readMeters.map(r => (
                      <div key={r.id} className="bg-white rounded-xl shadow-sm p-4 flex items-center gap-3 opacity-70">
                        <svg className="w-5 h-5 text-green-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold text-gray-700 truncate">{r.unit_label ?? '—'}</p>
                          <p className="text-sm text-gray-400 truncate">#{r.meter_number} · {r.current_value}</p>
                          <p className="text-xs text-gray-400 mt-0.5">
                            {r.read_by ?? 'Unknown'}{r.reading_date ? ` · ${r.reading_date}` : ''}
                          </p>
                          {r.notes && (
                            <p className="text-xs text-orange-500 mt-0.5 truncate">{r.notes}</p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Refresh footer */}
      {!loading && (
        <div className="px-4 pb-6 pt-2">
          <button
            onClick={() => void load()}
            className="w-full flex items-center justify-center gap-2 py-2 text-sm text-gray-400"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            Refresh list
          </button>
        </div>
      )}
    </div>
  )
}
