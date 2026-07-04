import { useState, useEffect, useCallback, useRef } from 'react'
import { getUnreadMeters, getReadMeters, getMyAssignments, type UnreadMeter, type ReadMeter } from '../api'
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

function formatElapsed(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m ${s}s`
  return `${s}s`
}

export default function MeterList({
  period,
  refreshKey,
  sessionStart,
  onMeterSelect,
  onChangePeriod,
  onShowQueue,
  onRegister,
  onLogout,
}: {
  period: string
  refreshKey: number
  sessionStart: number
  onMeterSelect: (m: UnreadMeter, list: UnreadMeter[], index: number) => void
  onChangePeriod: () => void
  onShowQueue: () => void
  onRegister?: () => void
  onLogout: () => void
}) {
  const [meters, setMeters]               = useState<UnreadMeter[]>([])
  const [readMeters, setReadMeters]       = useState<ReadMeter[]>([])
  const [hasAssignments, setHasAssignments] = useState(false)
  const [showRead, setShowRead]           = useState(false)
  const [loading, setLoading]             = useState(true)
  const [error, setError]                 = useState('')
  const [pending, setPending]             = useState(0)
  const [query, setQuery]                 = useState('')
  const [elapsed, setElapsed]             = useState(0)
  const completedAt                       = useRef<number | null>(null)

  // Live elapsed timer
  useEffect(() => {
    const interval = setInterval(() => {
      setElapsed(Math.floor((Date.now() - sessionStart) / 1000))
    }, 1000)
    return () => clearInterval(interval)
  }, [sessionStart])

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [unread, read, assigned] = await Promise.all([
        getUnreadMeters(period),
        getReadMeters(period),
        getMyAssignments(period).catch(() => []),
      ])
      setReadMeters(read)
      if (assigned.length > 0) {
        // Reorder unread meters to match assignment sort order; show only assigned ones
        const orderMap = new Map(assigned.map(a => [a.meter_number, a.sort_order]))
        const assignedUnread = unread
          .filter(m => orderMap.has(m.meter_number))
          .sort((a, b) => (orderMap.get(a.meter_number) ?? 999) - (orderMap.get(b.meter_number) ?? 999))
        setMeters(assignedUnread)
        setHasAssignments(true)
      } else {
        setMeters(unread)
        setHasAssignments(false)
      }
      // Record when all meters were first completed
      if (unread.length === 0 && completedAt.current === null) {
        completedAt.current = Date.now()
      }
    } catch (e: unknown) {
      const status = (e as { status?: number }).status
      if (status === 403)      setError('No permission to view meters. Contact your administrator.')
      else if (status === 401) setError('Session expired. Please sign in again.')
      else                     setError('Could not load meters. Check your connection and try again.')
    } finally {
      setLoading(false)
    }
    setPending(await countPending())
  }, [period])

  useEffect(() => { void load() }, [load, refreshKey])

  // Filtered unread meters
  const q = query.trim().toLowerCase()
  const filtered = q
    ? meters.filter(m =>
        m.unit_label.toLowerCase().includes(q) ||
        m.meter_number.toLowerCase().includes(q)
      )
    : meters

  const total    = meters.length + readMeters.length
  const progress = total > 0 ? Math.round((readMeters.length / total) * 100) : 0

  // ── All-done screen ──────────────────────────────────────────────────────────
  if (!loading && !error && meters.length === 0 && readMeters.length > 0) {
    const duration = formatElapsed(Math.floor(
      ((completedAt.current ?? Date.now()) - sessionStart) / 1000
    ))
    return (
      <div className="flex flex-col min-h-screen bg-gray-50">
        <div className="bg-green-600 text-white px-4 pt-12 pb-5 safe-top">
          <div className="flex items-center justify-between">
            <button onClick={onChangePeriod} className="text-green-200 text-sm active:text-white">
              ← {formatPeriod(period)}
            </button>
            <button onClick={onLogout} className="text-green-200 text-sm active:text-white">Sign out</button>
          </div>
        </div>

        <div className="flex-1 flex flex-col items-center justify-center px-6 py-12 text-center">
          <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mb-5">
            <svg className="w-10 h-10 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h2 className="text-2xl font-bold text-gray-900">All done!</h2>
          <p className="text-gray-500 mt-1 text-sm">All meters read for {formatPeriod(period)}</p>

          <div className="mt-6 bg-white rounded-2xl shadow-sm w-full max-w-xs p-5 space-y-3">
            <Stat label="Meters read" value={String(readMeters.length)} />
            <Stat label="Time taken"  value={duration} />
            {pending > 0 && <Stat label="Queued offline" value={String(pending)} highlight />}
          </div>

          <div className="mt-5 bg-white rounded-2xl shadow-sm w-full max-w-xs overflow-hidden">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide px-4 py-3">
              Meters read this session
            </p>
            <div className="divide-y divide-gray-50 max-h-60 overflow-y-auto">
              {readMeters.map(r => (
                <div key={r.id} className="flex items-center px-4 py-2.5 gap-3">
                  <svg className="w-4 h-4 text-green-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-800 truncate">{r.unit_label ?? '—'}</p>
                    <p className="text-xs text-gray-400 truncate">#{r.meter_number} · {r.current_value}</p>
                  </div>
                  {r.notes?.includes('inaccessible') && (
                    <span className="text-xs text-orange-500 shrink-0">Inaccessible</span>
                  )}
                </div>
              ))}
            </div>
          </div>

          {pending > 0 && (
            <button
              onClick={onShowQueue}
              className="mt-4 w-full max-w-xs bg-orange-500 text-white rounded-2xl py-3.5 font-semibold text-sm active:bg-orange-600"
            >
              Sync {pending} queued reading{pending !== 1 ? 's' : ''}
            </button>
          )}
        </div>
      </div>
    )
  }

  // ── Normal list ──────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col min-h-screen bg-gray-50">

      {/* Header */}
      <div className="bg-green-600 text-white px-4 pt-12 pb-4 safe-top">
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
            {onRegister && (
              <button onClick={onRegister} className="text-green-200 active:text-white" title="Register new meter">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
              </button>
            )}
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
            <button onClick={onLogout} className="text-green-200 text-sm active:text-white">Sign out</button>
          </div>
        </div>

        <div className="flex items-end justify-between">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold">Meter Readings</h1>
              {!loading && hasAssignments && (
                <span className="text-xs bg-white/20 text-white px-2 py-0.5 rounded-full font-medium">Assigned</span>
              )}
            </div>
            {!loading && (
              <div className="flex items-center gap-3 mt-1">
                <p className="text-green-200 text-sm">
                  {meters.length} unread · {readMeters.length} read
                </p>
                {total > 0 && (
                  <div className="flex-1 bg-white/20 rounded-full h-1.5 w-24">
                    <div
                      className="bg-white rounded-full h-1.5 transition-all"
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                )}
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            {!loading && meters.length > 0 && (
              <button
                onClick={() => downloadManifest(meters, period)}
                title="Download route manifest"
                className="text-green-200 active:text-white"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M12 10v6m0 0l-3-3m3 3l3-3M3 17V7a2 2 0 012-2h6l2 2h6a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
                </svg>
              </button>
            )}
            {!loading && elapsed > 0 && (
              <p className="text-green-300 text-xs font-medium">{formatElapsed(elapsed)}</p>
            )}
          </div>
        </div>
      </div>

      {/* Search bar */}
      {!loading && !error && meters.length > 0 && (
        <div className="px-4 py-2 bg-white border-b border-gray-100">
          <div className="flex items-center gap-2 bg-gray-100 rounded-xl px-3 py-2">
            <svg className="w-4 h-4 text-gray-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="search"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search unit or meter number…"
              className="flex-1 bg-transparent text-sm text-gray-900 placeholder-gray-400 focus:outline-none"
            />
            {query && (
              <button onClick={() => setQuery('')} className="text-gray-400 active:text-gray-600">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
        </div>
      )}

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
            {/* Search result count */}
            {q && (
              <p className="text-xs text-gray-400 px-1">
                {filtered.length} of {meters.length} meters match "{query}"
              </p>
            )}

            {filtered.length === 0 && q ? (
              <div className="text-center py-10 text-gray-400 text-sm">
                No meters match "{query}"
              </div>
            ) : (
              filtered.map((m, idx) => (
                <button
                  key={m.id}
                  onClick={() => onMeterSelect(m, filtered, idx)}
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
              ))
            )}

            {/* Already-read section */}
            {readMeters.length > 0 && (
              <div className="pt-2">
                <button
                  onClick={() => setShowRead(v => !v)}
                  className="flex items-center gap-2 text-sm font-medium text-gray-400 py-2 w-full"
                >
                  <svg className={`w-4 h-4 transition-transform ${showRead ? 'rotate-90' : ''}`}
                    fill="none" stroke="currentColor" viewBox="0 0 24 24">
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

// ── Small helpers ─────────────────────────────────────────────────────────────
function downloadManifest(meters: UnreadMeter[], period: string) {
  const rows = ['#,Unit,Meter Number,Utility,Last Reading,Last Reading Date']
  meters.forEach((m, i) => {
    rows.push([
      i + 1,
      `"${m.unit_label}"`,
      m.meter_number,
      m.utility_type,
      m.last_reading ?? '',
      m.last_reading_date ?? '',
    ].join(','))
  })
  const blob = new Blob([rows.join('\n')], { type: 'text/csv' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href     = url
  a.download = `route-${period}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

function Stat({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="flex justify-between items-center">
      <span className="text-sm text-gray-500">{label}</span>
      <span className={`text-sm font-bold ${highlight ? 'text-orange-500' : 'text-gray-900'}`}>{value}</span>
    </div>
  )
}
