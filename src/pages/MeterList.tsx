import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { getUnreadMeters, getReadMeters, getMyAssignments, submitReading, type UnreadMeter, type ReadMeter } from '../api'
import { countPending, queueReading, saveMeterCache, loadMeterCache, listPending } from '../db'
import { syncPendingWithProgress } from '../sync'

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

function formatSynced(d: Date): string {
  const mins = Math.floor((Date.now() - d.getTime()) / 60000)
  if (mins < 1) return 'just now'
  return `${mins}m ago`
}

function daysSince(dateStr: string | null): number | null {
  if (!dateStr) return null
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000)
}

export default function MeterList({
  period,
  refreshKey,
  sessionStart,
  onMeterSelect,
  onChangePeriod,
  onShowQueue,
  onRegister,
  onGoToDashboard,
  onLogout,
}: {
  period: string
  refreshKey: number
  sessionStart: number
  onMeterSelect: (m: UnreadMeter, list: UnreadMeter[], index: number) => void
  onChangePeriod: () => void
  onShowQueue: () => void
  onRegister?: () => void
  onGoToDashboard?: () => void
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
  const [utilityFilter, setUtilityFilter] = useState<string>('all')
  const [elapsed, setElapsed]             = useState(0)
  const [pullProgress, setPullProgress]   = useState(0)
  const [lastSynced, setLastSynced]       = useState<Date | null>(null)
  const [highContrast, setHighContrast]   = useState(() => localStorage.getItem('pwa_hc') === '1')
  const [soundOn, setSoundOn]             = useState(() => localStorage.getItem('pwa_sound') !== '0')
  const [skipConfirm, setSkipConfirm]     = useState(() => localStorage.getItem('pwa_skip_confirm') === '1')
  const [isOnline, setIsOnline]           = useState(() => navigator.onLine)
  const [syncing, setSyncing]             = useState(false)
  const [visibleCount, setVisibleCount]   = useState(50)
  const completedAt                       = useRef<number | null>(null)
  const sentinelRef                       = useRef<HTMLDivElement>(null)
  const filteredLenRef                    = useRef(0)
  const touchStartY                       = useRef(0)
  const bodyRef                           = useRef<HTMLDivElement>(null)
  const longPressRef                      = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Smart meter inspect modal
  const [smartTarget, setSmartTarget] = useState<UnreadMeter | null>(null)
  const [smartNotes, setSmartNotes]   = useState('')
  const [smartSeal, setSmartSeal]     = useState(true)

  // Long-press → quick inaccessible
  const [inaccessibleTarget, setInaccessibleTarget]   = useState<UnreadMeter | null>(null)
  const [inaccessibleLoading, setInaccessibleLoading] = useState(false)

  function startLongPress(m: UnreadMeter) {
    longPressRef.current = setTimeout(() => {
      navigator.vibrate?.(50)
      setInaccessibleTarget(m)
    }, 600)
  }
  function cancelLongPress() {
    if (longPressRef.current) { clearTimeout(longPressRef.current); longPressRef.current = null }
  }

  async function confirmInaccessible(m: UnreadMeter) {
    setInaccessibleLoading(true)
    const value = m.last_reading ?? 0
    const note  = 'Meter inaccessible'
    try {
      await submitReading(m.id, value, period, undefined, note)
    } catch {
      await queueReading({ meterId: m.id, meterNumber: m.meter_number, unitLabel: m.unit_label, currentValue: value, billingPeriod: period, notes: note, queuedAt: Date.now() })
    }
    setInaccessibleTarget(null)
    setInaccessibleLoading(false)
    void load()
  }

  // Live elapsed timer
  useEffect(() => {
    const interval = setInterval(() => {
      setElapsed(Math.floor((Date.now() - sessionStart) / 1000))
    }, 1000)
    return () => clearInterval(interval)
  }, [sessionStart])

  // IDs of meters that are queued locally for this period (submitted but not yet synced)
  async function getPendingMeterIds(p: string): Promise<Set<string>> {
    const pending = await listPending().catch(() => [])
    return new Set(pending.filter(r => r.billingPeriod === p).map(r => r.meterId))
  }

  // Hydrate from cache immediately — before the network fetch arrives
  useEffect(() => {
    loadMeterCache(period).then(async cached => {
      if (cached && cached.meters.length > 0) {
        const queued = await getPendingMeterIds(period)
        const meters = queued.size > 0
          ? (cached.meters as UnreadMeter[]).filter(m => !queued.has(m.id))
          : (cached.meters as UnreadMeter[])
        setMeters(meters)
        setLoading(false)
      }
    }).catch(() => {})
  }, [period])

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
      let displayMeters: UnreadMeter[]
      if (assigned.length > 0) {
        // Reorder unread meters to match assignment sort order; show only assigned ones
        const orderMap = new Map(assigned.map(a => [a.meter_number, a.sort_order]))
        displayMeters = unread
          .filter(m => orderMap.has(m.meter_number))
          .sort((a, b) => (orderMap.get(a.meter_number) ?? 999) - (orderMap.get(b.meter_number) ?? 999))
        setHasAssignments(true)
      } else {
        displayMeters = unread
        setHasAssignments(false)
      }
      // Exclude meters already in the local pending queue (submitted offline, not yet synced)
      const queued = await getPendingMeterIds(period)
      const visibleMeters = queued.size > 0
        ? displayMeters.filter(m => !queued.has(m.id))
        : displayMeters
      setMeters(visibleMeters)
      // Persist to cache for offline use (save full server list — pending filter applied on display)
      void saveMeterCache(period, displayMeters)
      // Record when all meters were first completed
      if (unread.length === 0 && completedAt.current === null) {
        completedAt.current = Date.now()
      }
      setLastSynced(new Date())
    } catch (e: unknown) {
      const status = (e as { status?: number }).status
      if (status === 403)      setError('No permission to view meters. Contact your administrator.')
      else if (status === 401) setError('Session expired. Please sign in again.')
      else if (!navigator.onLine) { /* keep showing cached data silently */ }
      else                     setError('Could not load meters. Check your connection and try again.')
    } finally {
      setLoading(false)
    }
    setPending(await countPending())
  }, [period])

  useEffect(() => { void load() }, [load, refreshKey])

  // Online/offline tracking — also refresh meter list when connection is restored
  useEffect(() => {
    const handleOnline  = () => { setIsOnline(true); void load() }
    const handleOffline = () => setIsOnline(false)
    window.addEventListener('online',  handleOnline)
    window.addEventListener('offline', handleOffline)
    return () => { window.removeEventListener('online', handleOnline); window.removeEventListener('offline', handleOffline) }
  }, [load])

  // Intersection observer: load more items as user scrolls toward sentinel
  useEffect(() => {
    const el = sentinelRef.current
    if (!el || visibleCount >= filteredLenRef.current) return
    const obs = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting)
        setVisibleCount(c => Math.min(c + 50, filteredLenRef.current))
    }, { threshold: 0.1 })
    obs.observe(el)
    return () => obs.disconnect()
  }, [visibleCount])

  // Pull-to-refresh handlers
  function handleTouchStart(e: React.TouchEvent) {
    touchStartY.current = e.touches[0].clientY
  }
  function handleTouchMove(e: React.TouchEvent) {
    const el = bodyRef.current
    if (!el || el.scrollTop > 0) return
    const dy = e.touches[0].clientY - touchStartY.current
    if (dy > 0) setPullProgress(Math.min(1, dy / 70))
  }
  function handleTouchEnd() {
    if (pullProgress >= 1) void load()
    setPullProgress(0)
  }

  // Sync now handler (for inline banner button)
  async function handleSyncNow() {
    if (syncing || !navigator.onLine) return
    setSyncing(true)
    await syncPendingWithProgress(() => {}, () => {})
    setPending(await countPending())
    setSyncing(false)
  }

  // Reset visible count when search/filter changes
  useEffect(() => { setVisibleCount(50) }, [query, utilityFilter])

  // Collect unique utility types for the filter chips
  const utilityTypes = useMemo(() => {
    const types = [...new Set(meters.map(m => m.utility_type))]
    return types.sort()
  }, [meters])

  // Filtered unread meters
  const q = query.trim().toLowerCase()
  const filtered = meters.filter(m => {
    if (utilityFilter !== 'all' && m.utility_type !== utilityFilter) return false
    if (q && !m.unit_label.toLowerCase().includes(q) && !m.meter_number.toLowerCase().includes(q)) return false
    return true
  })

  filteredLenRef.current = filtered.length   // keep ref in sync for intersection observer
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
            {readMeters.length > 1 && (
              <Stat label="Avg per meter" value={formatElapsed(Math.floor(
                ((completedAt.current ?? Date.now()) - sessionStart) / 1000 / readMeters.length
              ))} />
            )}
            {(() => {
              const inacc    = readMeters.filter(r => r.notes?.includes('inaccessible')).length
              const anomalies = readMeters.filter(r => r.anomaly).length
              const tampered  = readMeters.filter(r => r.tampered).length
              return <>
                {inacc     > 0 && <Stat label="Inaccessible" value={String(inacc)}     highlight />}
                {anomalies > 0 && <Stat label="Anomalies"    value={String(anomalies)} highlight />}
                {tampered  > 0 && <Stat label="Tampered"     value={String(tampered)}  highlight />}
              </>
            })()}
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

          {onGoToDashboard && (
            <button
              onClick={onGoToDashboard}
              className="mt-3 w-full max-w-xs bg-indigo-600 text-white rounded-2xl py-3.5 font-semibold text-sm active:bg-indigo-700"
            >
              View Supervisor Dashboard
            </button>
          )}

          {'share' in navigator && (
            <button
              onClick={() => void (navigator as Navigator & { share(d: object): Promise<void> }).share({
                title: `Meter readings — ${formatPeriod(period)}`,
                text: `Completed ${readMeters.length} meter reading${readMeters.length !== 1 ? 's' : ''} for ${formatPeriod(period)} in ${duration}.`,
              })}
              className="mt-3 w-full max-w-xs bg-gray-100 text-gray-700 rounded-2xl py-3.5 font-semibold text-sm active:bg-gray-200 flex items-center justify-center gap-2"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
              </svg>
              Share summary
            </button>
          )}
        </div>
      </div>
    )
  }

  // High-contrast helpers
  const hcClass = highContrast ? ' high-contrast' : ''
  function toggleHC() {
    const next = !highContrast
    setHighContrast(next)
    localStorage.setItem('pwa_hc', next ? '1' : '0')
  }
  function toggleSound() {
    const next = !soundOn
    setSoundOn(next)
    localStorage.setItem('pwa_sound', next ? '1' : '0')
  }
  function toggleSkipConfirm() {
    const next = !skipConfirm
    setSkipConfirm(next)
    localStorage.setItem('pwa_skip_confirm', next ? '1' : '0')
  }

  // ── Normal list ──────────────────────────────────────────────────────────────
  return (
    <div className={`flex flex-col min-h-screen bg-gray-50${hcClass}`}>

      {/* Quick-inaccessible confirmation overlay */}
      {inaccessibleTarget && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-end">
          <div className="bg-white rounded-t-3xl w-full p-5 pb-8 space-y-3">
            <div className="w-10 h-1 bg-gray-200 rounded-full mx-auto" />
            <h2 className="text-lg font-bold text-gray-900">Mark as inaccessible?</h2>
            <p className="text-sm text-gray-500">{inaccessibleTarget.unit_label} · #{inaccessibleTarget.meter_number}</p>
            <p className="text-xs text-gray-400">
              Previous reading ({inaccessibleTarget.last_reading ?? 0}) will be submitted with an inaccessible note.
            </p>
            <div className="flex gap-3 pt-1">
              <button
                onClick={() => { cancelLongPress(); setInaccessibleTarget(null) }}
                className="flex-1 border-2 border-gray-200 text-gray-700 rounded-2xl py-3 font-semibold"
              >
                Cancel
              </button>
              <button
                onClick={() => void confirmInaccessible(inaccessibleTarget)}
                disabled={inaccessibleLoading}
                className="flex-1 bg-orange-500 text-white rounded-2xl py-3 font-semibold disabled:opacity-50"
              >
                {inaccessibleLoading ? 'Saving…' : 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Smart meter inspect bottom sheet */}
      {smartTarget && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-end">
          <div className="bg-white rounded-t-3xl w-full p-5 pb-8 space-y-4">
            <div className="w-10 h-1 bg-gray-200 rounded-full mx-auto" />
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold px-2 py-0.5 rounded bg-indigo-100 text-indigo-700">Smart / AMR</span>
              <h2 className="text-lg font-bold text-gray-900">Field Inspection</h2>
            </div>
            <p className="text-sm text-gray-500">{smartTarget.unit_label} · #{smartTarget.meter_number}</p>

            <div className="bg-indigo-50 rounded-xl px-4 py-3">
              <p className="text-xs text-indigo-600 font-medium">Last transmitted reading</p>
              <p className="text-2xl font-bold text-indigo-800 mt-0.5">{smartTarget.last_reading ?? '—'}</p>
              <p className="text-xs text-indigo-500 mt-0.5">
                {smartTarget.last_reading_date
                  ? new Date(smartTarget.last_reading_date).toLocaleDateString()
                  : 'No previous reading'}
              </p>
            </div>

            <label className="flex items-center gap-3 py-1">
              <input
                type="checkbox"
                checked={smartSeal}
                onChange={e => setSmartSeal(e.target.checked)}
                className="w-5 h-5 accent-green-600"
              />
              <span className="text-sm font-medium text-gray-700">Seal / tamper indicator intact</span>
            </label>

            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1">Notes (optional)</label>
              <textarea
                value={smartNotes}
                onChange={e => setSmartNotes(e.target.value)}
                placeholder="Any observations about the meter…"
                rows={2}
                className="w-full text-sm text-gray-900 border border-gray-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
              />
            </div>

            <div className="flex gap-3 pt-1">
              <button
                onClick={() => setSmartTarget(null)}
                className="flex-1 border-2 border-gray-200 text-gray-700 rounded-2xl py-3 font-semibold"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  const m = smartTarget
                  setSmartTarget(null)
                  // Proceed to ReadingEntry with smart meter context
                  onMeterSelect(m, filtered.filter(x => x.meter_type === 'smart'), 0)
                }}
                className="flex-1 bg-indigo-600 text-white rounded-2xl py-3 font-semibold active:bg-indigo-700"
              >
                Proceed to confirm
              </button>
            </div>
          </div>
        </div>
      )}

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
            {lastSynced && !loading && (
              <span className="text-green-300 text-xs">Synced {formatSynced(lastSynced)}</span>
            )}
            <button
              onClick={toggleSound}
              className={`text-xs px-1.5 py-0.5 rounded border ${soundOn ? 'border-white text-white bg-white/20' : 'border-green-400/60 text-green-300'}`}
              title={soundOn ? 'Sound on' : 'Sound off'}
            >🔔</button>
            <button
              onClick={toggleSkipConfirm}
              className={`text-xs px-1.5 py-0.5 rounded border ${skipConfirm ? 'border-white text-white bg-white/20' : 'border-green-400/60 text-green-300'}`}
              title={skipConfirm ? 'Skip confirm: on' : 'Skip confirm: off'}
            >⚡</button>
            <button
              onClick={toggleHC}
              className={`text-xs font-bold px-1.5 py-0.5 rounded border ${highContrast ? 'border-white text-white bg-white/20' : 'border-green-400/60 text-green-300'}`}
              title="Toggle high-contrast mode"
            >HC</button>
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

      {/* Utility type filter chips — shown when more than one type */}
      {!loading && !error && utilityTypes.length > 1 && (
        <div className="px-4 py-2 bg-white border-b border-gray-100 flex items-center gap-1.5 overflow-x-auto">
          {(['all', ...utilityTypes] as string[]).map(type => (
            <button
              key={type}
              onClick={() => setUtilityFilter(type)}
              className={`shrink-0 px-3 py-1 rounded-full text-xs font-semibold border transition-colors ${
                utilityFilter === type
                  ? 'bg-green-600 border-green-600 text-white'
                  : 'border-gray-200 text-gray-500 bg-white'
              }`}
            >
              {type === 'all' ? 'All' : type.replace('_', ' ')}
            </button>
          ))}
        </div>
      )}

      {/* Sync-now banner — online with pending items */}
      {isOnline && pending > 0 && !loading && (
        <div className="bg-indigo-50 border-b border-indigo-100 px-4 py-2 flex items-center justify-between gap-2">
          <p className="text-xs text-indigo-700 font-medium">{pending} reading{pending !== 1 ? 's' : ''} waiting to sync</p>
          <button
            onClick={() => void handleSyncNow()}
            disabled={syncing}
            className="text-xs font-semibold text-indigo-700 bg-indigo-100 px-2.5 py-1 rounded-lg disabled:opacity-50 active:bg-indigo-200"
          >
            {syncing ? 'Syncing…' : 'Sync now'}
          </button>
        </div>
      )}

      {/* Offline stale-data banner */}
      {!isOnline && lastSynced && (
        <div className="bg-orange-50 border-b border-orange-100 px-4 py-2 flex items-center gap-2">
          <svg className="w-4 h-4 text-orange-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <p className="text-xs text-orange-700 font-medium">
            Offline — showing list from {formatSynced(lastSynced)}
          </p>
        </div>
      )}

      {/* Body */}
      <div
        ref={bodyRef}
        className="flex-1 px-4 py-4 overflow-y-auto"
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        {/* Pull-to-refresh indicator */}
        {pullProgress > 0 && (
          <div className="flex justify-center pb-2 -mt-2">
            <div
              className={`w-6 h-6 rounded-full border-2 border-green-600 border-t-transparent ${pullProgress >= 1 ? 'animate-spin' : ''}`}
              style={{ transform: `rotate(${pullProgress * 270}deg)`, opacity: pullProgress }}
            />
          </div>
        )}
        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="bg-white rounded-xl shadow-sm p-4 flex items-center gap-3 animate-pulse">
                <div className="flex-1 space-y-2">
                  <div className="flex items-center gap-2">
                    <div className="h-4 bg-gray-200 rounded w-2/3" />
                    <div className="h-4 bg-gray-100 rounded w-12" />
                  </div>
                  <div className="h-3 bg-gray-100 rounded w-1/2" />
                </div>
                <div className="w-5 h-5 bg-gray-100 rounded-full" />
              </div>
            ))}
          </div>
        ) : error ? (
          <div className="text-center py-12">
            <p className="text-gray-500 mb-3">{error}</p>
            <button onClick={() => void load()} className="text-green-600 font-medium">Retry</button>
          </div>
        ) : meters.length === 0 ? (
          <div className="text-center py-16 px-6">
            <div className="text-5xl mb-4">📋</div>
            <p className="font-semibold text-gray-900 text-lg">Reading cycle complete</p>
            <p className="text-sm text-gray-500 mt-1">
              All meters have been read for {formatPeriod(period)}.
            </p>
            <p className="text-xs text-gray-400 mt-3">
              Contact your supervisor if you believe meters are missing.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {/* Search result count */}
            {(q || utilityFilter !== 'all') && (
              <p className="text-xs text-gray-400 px-1">
                {filtered.length} of {meters.length} meters{q ? ` match "${query}"` : ''}
              </p>
            )}

            {filtered.length === 0 && (q || utilityFilter !== 'all') ? (
              <div className="text-center py-10 text-gray-400 text-sm">
                {q ? `No meters match "${query}"` : `No unread ${utilityFilter.replace('_', ' ')} meters`}
              </div>
            ) : (
              filtered.slice(0, visibleCount).map((m, idx) => {
                const days = daysSince(m.last_reading_date)
                const isOverdue = days !== null && days > 35
                const isSmart = m.meter_type === 'smart'
                return (
                  <button
                    key={m.id}
                    onClick={() => {
                      if (isSmart) { setSmartTarget(m); setSmartNotes(''); setSmartSeal(true) }
                      else         { onMeterSelect(m, filtered, idx) }
                    }}
                    onTouchStart={() => { if (!isSmart) startLongPress(m) }}
                    onTouchEnd={cancelLongPress}
                    onTouchMove={cancelLongPress}
                    onMouseDown={() => { if (!isSmart) startLongPress(m) }}
                    onMouseUp={cancelLongPress}
                    onMouseLeave={cancelLongPress}
                    className="w-full bg-white rounded-xl shadow-sm p-4 text-left active:bg-gray-50 flex items-center gap-3 select-none"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <span className="font-semibold text-gray-900 truncate">{m.unit_label}</span>
                        <span className={`shrink-0 text-xs px-2 py-0.5 rounded-full font-medium ${UTILITY_BADGE[m.utility_type] ?? 'bg-gray-100 text-gray-600'}`}>
                          {m.utility_type.replace('_', ' ')}
                        </span>
                        {isSmart && (
                          <span className="shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-700">Smart</span>
                        )}
                        {m.last_reading_source === 'estimated' && (
                          <span className="shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-yellow-100 text-yellow-700">Est.</span>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <p className="text-sm text-gray-500 truncate">
                          #{m.meter_number} · Prev: {m.last_reading ?? '—'}
                        </p>
                        {isOverdue && days !== null && (
                          <span className={`shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded ${days > 60 ? 'bg-red-100 text-red-600' : 'bg-orange-100 text-orange-600'}`}>
                            {days}d
                          </span>
                        )}
                      </div>
                      {isSmart && (
                        <p className="text-[10px] text-indigo-500 mt-0.5">Auto-read · tap to inspect</p>
                      )}
                    </div>
                    <svg className="w-5 h-5 text-gray-300 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </button>
                )
              })
            )}

            {/* Load-more sentinel for large lists */}
            {visibleCount < filtered.length && (
              <div ref={sentinelRef} className="py-3 text-center text-xs text-gray-400">
                {filtered.length - visibleCount} more…
              </div>
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
