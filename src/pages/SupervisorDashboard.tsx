import { useState, useEffect, useCallback, useRef } from 'react'
import {
  getReadingProgress, getReaderPerformance, getUnreadMeters, getAnomalyReadings, getTamperedReadings,
  getAssignmentSummary, getAvailableReaders, assignByBlock, clearByBlock, getOnlineDevices,
  type ReadingProgress, type ReaderPerformance, type UnreadMeter, type ReadMeter,
  type AssignmentPhase, type AvailableReader, type AssignmentBlock, type OnlineDevice,
} from '../api'

function formatPeriod(p: string): string {
  const [year, month] = p.split('-')
  return new Date(parseInt(year), parseInt(month) - 1, 1)
    .toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
}

function prevPeriod(p: string): string {
  const [y, m] = p.split('-').map(Number)
  const d = new Date(y, m - 2, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export default function SupervisorDashboard({
  period,
  onChangePeriod,
  onGoToList,
  onLogout,
}: {
  period: string
  onChangePeriod: () => void
  onGoToList: () => void
  onLogout: () => void
}) {
  type DashTab = 'overview' | 'unread' | 'smart' | 'anomalies' | 'tampered' | 'assign' | 'devices'

  const [tab, setTab]                   = useState<DashTab>('overview')
  const [progress, setProgress]         = useState<ReadingProgress | null>(null)
  const [performance, setPerformance]   = useState<ReaderPerformance[]>([])
  const [unreadMeters, setUnreadMeters] = useState<UnreadMeter[]>([])
  const [anomalyReadings, setAnomalyReadings]   = useState<ReadMeter[]>([])
  const [tamperedReadings, setTamperedReadings] = useState<ReadMeter[]>([])
  const [loading, setLoading]           = useState(true)
  const [error, setError]               = useState('')
  const [refreshKey, setRefreshKey]     = useState(0)
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null)
  const [showDoneToast, setShowDoneToast] = useState(false)
  const prevUnreadRef = useRef<number | null>(null)
  const [prevProgress, setPrevProgress]   = useState<ReadingProgress | null>(null)
  const [anomalyReaderFilter, setAnomalyReaderFilter] = useState('all')
  const [unreadSearch, setUnreadSearch]   = useState('')
  const [tamperedSearch, setTamperedSearch] = useState('')
  const [blockSummary, setBlockSummary]   = useState<AssignmentBlock[]>([])
  const [onlineDevices, setOnlineDevices] = useState<OnlineDevice[]>([])

  useEffect(() => {
    setLoading(true)
    setError('')
    Promise.allSettled([
      getReadingProgress(period),
      getReaderPerformance(period),
      getUnreadMeters(period),
      getAnomalyReadings(period),
      getTamperedReadings(period),
      getReadingProgress(prevPeriod(period)),
      getAssignmentSummary(period),
      getOnlineDevices(),
    ]).then(([progR, perfR, unreadR, anomaliesR, tamperedR, prevR, assignR, devicesR]) => {
      if (progR.status === 'rejected') {
        const msg = (progR.reason as Error)?.message ?? 'Unknown error'
        setError(`Failed to load data: ${msg}`)
        setLoading(false)
        return
      }
      const prog = progR.value
      // All-done toast: fire when unread transitions from > 0 → 0 on refresh
      if (prevUnreadRef.current !== null && prevUnreadRef.current > 0 && prog.total_unread === 0) {
        setShowDoneToast(true)
        setTimeout(() => setShowDoneToast(false), 4000)
      }
      prevUnreadRef.current = prog.total_unread
      setProgress(prog)
      setPerformance(perfR.status === 'fulfilled' ? perfR.value : [])
      setUnreadMeters(unreadR.status === 'fulfilled' ? unreadR.value : [])
      setAnomalyReadings(anomaliesR.status === 'fulfilled' ? anomaliesR.value : [])
      setTamperedReadings(tamperedR.status === 'fulfilled' ? tamperedR.value : [])
      setPrevProgress(prevR.status === 'fulfilled' ? prevR.value : null)
      if (assignR.status === 'fulfilled') {
        setBlockSummary(assignR.value.flatMap(p => p.blocks))
      }
      if (devicesR.status === 'fulfilled') setOnlineDevices(devicesR.value)
      setLastRefreshed(new Date())
    }).finally(() => setLoading(false))
  }, [period, refreshKey])

  // Auto-refresh every 30s when page is visible
  useEffect(() => {
    const interval = setInterval(() => {
      if (!document.hidden) setRefreshKey(k => k + 1)
    }, 30000)
    return () => clearInterval(interval)
  }, [])

  return (
    <div className="flex flex-col min-h-screen bg-gray-50">

      {/* All-done toast */}
      {showDoneToast && (
        <div className="fixed bottom-6 left-4 right-4 z-50 bg-green-600 text-white rounded-2xl px-5 py-4 shadow-xl flex items-center gap-3">
          <svg className="w-6 h-6 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
          </svg>
          <div className="flex-1 min-w-0">
            <p className="font-bold text-sm">All meters read!</p>
            <p className="text-xs text-green-200 mt-0.5">{formatPeriod(period)} is complete</p>
          </div>
          <button onClick={() => setShowDoneToast(false)} className="text-green-300 shrink-0">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}

      {/* Header */}
      <div className="bg-indigo-700 text-white px-4 pt-12 pb-5">
        <div className="flex items-center justify-between mb-2">
          <button onClick={onChangePeriod} className="text-indigo-200 text-sm active:text-white">
            ← {formatPeriod(period)}
          </button>
          <div className="flex items-center gap-3">
          {lastRefreshed && !loading && (
            <span className="text-indigo-300 text-xs">
              {lastRefreshed.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
          )}
          <button
            onClick={() => setRefreshKey(k => k + 1)}
            disabled={loading}
            className="text-indigo-200 active:text-white disabled:opacity-40"
            title="Refresh"
          >
            <svg className={`w-5 h-5 ${loading ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </button>
          <button onClick={onLogout} className="text-indigo-200 text-sm active:text-white">Sign out</button>
        </div>
        </div>
        <h1 className="text-2xl font-bold">Supervisor Overview</h1>
        <p className="text-indigo-300 text-sm mt-0.5">{formatPeriod(period)}</p>
        <button
          onClick={onGoToList}
          className="mt-3 w-full bg-white/15 hover:bg-white/25 active:bg-white/30 text-white font-semibold text-sm rounded-xl py-2.5 transition-colors"
        >
          Read Meters →
        </button>
      </div>

      {/* Tab bar */}
      <div className="flex border-b border-gray-200 bg-white">
        {([
          { key: 'overview',  label: 'Overview' },
          { key: 'unread',    label: `Unread${!loading && progress ? ` (${progress.total_unread})` : ''}` },
          { key: 'smart',     label: `Smart${!loading && unreadMeters.filter(m => m.meter_type === 'smart').length > 0 ? ` (${unreadMeters.filter(m => m.meter_type === 'smart').length})` : ''}` },
          { key: 'anomalies', label: `Anom.${!loading && anomalyReadings.length > 0 ? ` (${anomalyReadings.length})` : ''}` },
          { key: 'tampered',  label: `Tampered${!loading && tamperedReadings.length > 0 ? ` (${tamperedReadings.length})` : ''}` },
          { key: 'assign',    label: 'Assign' },
          { key: 'devices',   label: `Devices${!loading && onlineDevices.length > 0 ? ` (${onlineDevices.length})` : ''}` },
        ] as { key: DashTab; label: string }[]).map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex-1 py-3 text-xs font-semibold border-b-2 transition-colors ${
              tab === t.key ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-gray-400'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="flex-1 px-4 py-5 space-y-4">
        {loading ? (
          <div className="flex justify-center py-16">
            <div className="w-8 h-8 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : error ? (
          <div className="text-center py-12 text-gray-500">{error}</div>
        ) : (
          <>
            {/* ── OVERVIEW TAB ─────────────────────────────────────────────── */}
            {tab === 'overview' && progress && (
              <>
                <div className="bg-white rounded-2xl shadow-sm p-5">
                  <div className="flex items-center justify-between mb-4">
                    <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Reading Progress</p>
                    <div className="flex items-center gap-2">
                      {prevProgress && (() => {
                        const delta = Number(progress.completion_pct) - Number(prevProgress.completion_pct)
                        return (
                          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                            delta > 0 ? 'bg-green-50 text-green-700' : delta < 0 ? 'bg-red-50 text-red-600' : 'bg-gray-50 text-gray-400'
                          }`}>
                            {delta > 0 ? '↑' : delta < 0 ? '↓' : '→'}{Math.abs(delta).toFixed(1)}% vs last
                          </span>
                        )
                      })()}
                      <button onClick={() => exportProgressCsv(progress, period)} title="Export CSV" className="text-indigo-400 active:text-indigo-600">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3M3 17V7a2 2 0 012-2h6l2 2h6a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
                        </svg>
                      </button>
                    </div>
                  </div>
                  <div className="flex items-center gap-4 mb-4">
                    <div className="w-20 h-20 rounded-full border-8 border-indigo-100 flex items-center justify-center shrink-0"
                      style={{ background: `conic-gradient(#4f46e5 ${progress.completion_pct * 3.6}deg, #e0e7ff 0deg)` }}>
                      <span className="text-lg font-bold text-indigo-700">{Number(progress.completion_pct).toFixed(0)}%</span>
                    </div>
                    <div className="flex-1 space-y-2">
                      <StatRow label="Total meters" value={String(progress.total_active_meters)} />
                      <StatRow label="Read"          value={String(progress.total_read)}          color="text-green-600" />
                      <StatRow label="Unread"        value={String(progress.total_unread)}        color="text-red-500" />
                    </div>
                  </div>
                  {(progress.anomaly_count > 0 || progress.tampered_count > 0) && (
                    <div className="flex gap-2 pt-3 border-t border-gray-100">
                      {progress.anomaly_count > 0 && (
                        <button onClick={() => setTab('anomalies')}>
                          <AlertBadge label={`${progress.anomaly_count} anomaly ›`} color="orange" />
                        </button>
                      )}
                      {progress.tampered_count > 0 && (
                        <button onClick={() => setTab('tampered')}>
                          <AlertBadge label={`${progress.tampered_count} tampered ›`} color="red" />
                        </button>
                      )}
                    </div>
                  )}
                </div>

                {progress.by_reader.length > 0 && (
                  <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
                    <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide px-4 py-3">By Reader</p>
                    <div className="divide-y divide-gray-50">
                      {progress.by_reader.map(r => {
                        const pct = progress.total_active_meters > 0
                          ? Math.round((r.read_count / progress.total_active_meters) * 100)
                          : 0
                        return (
                          <div key={r.reader_name} className="px-4 py-3">
                            <div className="flex items-center justify-between mb-1.5">
                              <span className="text-sm font-medium text-gray-700">{r.reader_name}</span>
                              <span className="text-sm font-bold text-indigo-600">{r.read_count} read</span>
                            </div>
                            <div className="w-full bg-gray-100 rounded-full h-1.5">
                              <div
                                className="bg-indigo-500 h-1.5 rounded-full transition-all"
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}

                {blockSummary.length > 0 && (
                  <div className="bg-white rounded-2xl shadow-sm p-4">
                    <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Block Progress</p>
                    <div className="grid grid-cols-4 gap-2">
                      {blockSummary.map(block => {
                        const pct = block.total_meters > 0 ? block.assigned_meters / block.total_meters : 0
                        const isComplete = pct >= 1
                        const hasStarted = pct > 0 && pct < 1
                        return (
                          <div
                            key={block.block}
                            className={`rounded-xl p-2 text-center ${
                              isComplete ? 'bg-green-50' : hasStarted ? 'bg-yellow-50' : 'bg-gray-50'
                            }`}
                          >
                            <p className={`text-sm font-bold ${
                              isComplete ? 'text-green-700' : hasStarted ? 'text-yellow-700' : 'text-gray-400'
                            }`}>
                              {block.block}
                            </p>
                            <p className={`text-[10px] mt-0.5 ${isComplete ? 'text-green-600' : 'text-gray-400'}`}>
                              {block.assigned_meters}/{block.total_meters}
                            </p>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}

                {performance.length > 0 && (
                  <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
                    <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide px-4 py-3">Reader Performance</p>
                    <div className="divide-y divide-gray-50">
                      {performance.map(p => (
                        <div key={p.reader_name} className="px-4 py-3">
                          <p className="text-sm font-semibold text-gray-800">{p.reader_name}</p>
                          <div className="flex gap-4 mt-1.5 flex-wrap">
                            <PerfBadge label="Read"         value={p.readings_count} />
                            {p.anomaly_count > 0     && <PerfBadge label="Anomaly"     value={p.anomaly_count}     color="orange" />}
                            {p.tampered_count > 0    && <PerfBadge label="Tampered"    value={p.tampered_count}    color="red" />}
                            {p.inaccessible_count > 0 && <PerfBadge label="Inaccessible" value={p.inaccessible_count} color="gray" />}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}

            {/* ── UNREAD TAB ───────────────────────────────────────────────── */}
            {tab === 'unread' && (
              unreadMeters.length === 0 ? (
                <div className="text-center py-16">
                  <div className="text-5xl mb-3">✓</div>
                  <p className="font-semibold text-gray-900">All meters read!</p>
                  <p className="text-sm text-gray-500 mt-1">No unread meters for {formatPeriod(period)}</p>
                </div>
              ) : (() => {
                const q = unreadSearch.trim().toLowerCase()
                const filteredUnread = q
                  ? unreadMeters.filter(m => m.unit_label.toLowerCase().includes(q) || m.meter_number.toLowerCase().includes(q))
                  : unreadMeters
                return (
                  <div className="space-y-3">
                    <div className="flex items-center gap-2 bg-white rounded-xl shadow-sm px-3 py-2">
                      <svg className="w-4 h-4 text-gray-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                      </svg>
                      <input
                        type="search"
                        value={unreadSearch}
                        onChange={e => setUnreadSearch(e.target.value)}
                        placeholder="Search unit or meter…"
                        className="flex-1 text-sm text-gray-900 placeholder-gray-400 focus:outline-none bg-transparent"
                      />
                    </div>
                    <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
                      <div className="flex items-center justify-between px-4 py-3">
                        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">
                          {filteredUnread.length}{q ? ` of ${unreadMeters.length}` : ''} meter{filteredUnread.length !== 1 ? 's' : ''} not yet read
                        </p>
                        <button onClick={() => exportUnreadCsv(unreadMeters, period)} className="text-indigo-600 active:text-indigo-800" title="Export CSV">
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3M3 17V7a2 2 0 012-2h6l2 2h6a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
                          </svg>
                        </button>
                      </div>
                      <div className="divide-y divide-gray-50">
                        {filteredUnread.map(m => (
                          <div key={m.id} className="flex items-center gap-3 px-4 py-3">
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-semibold text-gray-900 truncate">{m.unit_label}</p>
                              <p className="text-xs text-gray-400">#{m.meter_number} · {m.utility_type.replace('_', ' ')}</p>
                            </div>
                            <span className="text-xs text-gray-400 shrink-0">Prev: {m.last_reading ?? '—'}</span>
                          </div>
                        ))}
                        {filteredUnread.length === 0 && (
                          <p className="text-center text-sm text-gray-400 py-8">No results for "{unreadSearch}"</p>
                        )}
                      </div>
                    </div>
                  </div>
                )
              })()
            )}

            {/* ── SMART METERS TAB ─────────────────────────────────────────── */}
            {tab === 'smart' && (() => {
              const smartMeters = unreadMeters.filter(m => m.meter_type === 'smart')
              if (smartMeters.length === 0) return (
                <div className="text-center py-16">
                  <div className="text-5xl mb-3">📡</div>
                  <p className="font-semibold text-gray-900">No smart meters pending</p>
                  <p className="text-sm text-gray-500 mt-1">All AMR/smart meters have readings for {formatPeriod(period)}</p>
                </div>
              )
              return (
                <div className="space-y-3">
                  <div className="bg-indigo-50 border border-indigo-200 rounded-xl px-4 py-3">
                    <p className="text-xs font-semibold text-indigo-700">
                      {smartMeters.length} smart meter{smartMeters.length !== 1 ? 's' : ''} awaiting AMR transmission or field inspection
                    </p>
                    <p className="text-xs text-indigo-500 mt-0.5">
                      These meters should auto-report via AMR. If overdue, a field visit may be required.
                    </p>
                  </div>
                  <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
                    <div className="divide-y divide-gray-50">
                      {smartMeters.map(m => (
                        <div key={m.id} className="flex items-center gap-3 px-4 py-3">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <p className="text-sm font-semibold text-gray-900 truncate">{m.unit_label}</p>
                              <span className="shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-700">Smart</span>
                            </div>
                            <p className="text-xs text-gray-400">#{m.meter_number} · {m.utility_type.replace('_', ' ')}</p>
                          </div>
                          <div className="text-right shrink-0">
                            <p className="text-xs text-gray-500">Prev: {m.last_reading ?? '—'}</p>
                            <p className="text-xs text-gray-400">{m.last_reading_date ?? 'Never read'}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )
            })()}

            {/* ── TAMPERED TAB ─────────────────────────────────────────────── */}
            {tab === 'tampered' && (
              tamperedReadings.length === 0 ? (
                <div className="text-center py-16">
                  <div className="text-5xl mb-3">✓</div>
                  <p className="font-semibold text-gray-900">No tampered meters</p>
                  <p className="text-sm text-gray-500 mt-1">No tamper/fault flags for {formatPeriod(period)}</p>
                </div>
              ) : (() => {
                const qt = tamperedSearch.trim().toLowerCase()
                const filteredTampered = qt
                  ? tamperedReadings.filter(r => (r.unit_label ?? '').toLowerCase().includes(qt) || r.meter_number.toLowerCase().includes(qt))
                  : tamperedReadings
                return (
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <div className="flex-1 flex items-center gap-2 bg-white rounded-xl shadow-sm px-3 py-2">
                      <svg className="w-4 h-4 text-gray-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                      </svg>
                      <input
                        type="search"
                        value={tamperedSearch}
                        onChange={e => setTamperedSearch(e.target.value)}
                        placeholder="Search unit or meter…"
                        className="flex-1 text-sm text-gray-900 placeholder-gray-400 focus:outline-none bg-transparent"
                      />
                    </div>
                    <button onClick={() => exportAnomalyCsv(tamperedReadings, period)} className="text-indigo-600 active:text-indigo-800 shrink-0" title="Export CSV">
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3M3 17V7a2 2 0 012-2h6l2 2h6a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
                      </svg>
                    </button>
                  </div>
                <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide px-4 py-3">
                    {filteredTampered.length}{qt ? ` of ${tamperedReadings.length}` : ''} tampered/fault reading{filteredTampered.length !== 1 ? 's' : ''}
                  </p>
                  <div className="divide-y divide-gray-50">
                    {filteredTampered.map(r => (
                      <div key={r.id} className="px-4 py-3">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-sm font-semibold text-gray-900 truncate">{r.unit_label ?? '—'}</p>
                            <p className="text-xs text-gray-400">#{r.meter_number} · {r.read_by ?? 'Unknown reader'}</p>
                          </div>
                          <div className="text-right shrink-0">
                            <p className="text-sm font-bold text-red-600">{Number(r.current_value).toLocaleString()}</p>
                            <p className="text-xs text-gray-400">{r.reading_date ?? '—'}</p>
                          </div>
                        </div>
                        <div className="flex gap-1.5 mt-1.5">
                          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-red-100 text-red-700">Tampered/Fault</span>
                          {r.anomaly && <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-orange-100 text-orange-700">⚠ High consumption</span>}
                        </div>
                        {r.notes && (
                          <p className="text-xs text-gray-400 mt-1 truncate">{r.notes}</p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
                </div>
                )
              })()
            )}

            {/* ── ASSIGN TAB ───────────────────────────────────────────────── */}
            {tab === 'assign' && <AssignTab period={period} />}

            {/* ── DEVICES TAB ──────────────────────────────────────────────── */}
            {tab === 'devices' && (
              onlineDevices.length === 0 ? (
                <div className="text-center py-16">
                  <div className="text-5xl mb-3">📵</div>
                  <p className="font-semibold text-gray-900">No devices online</p>
                  <p className="text-sm text-gray-500 mt-1">No field devices seen in the last 30 minutes</p>
                </div>
              ) : (
                <div className="space-y-2">
                  <p className="text-xs text-gray-400 font-medium">{onlineDevices.length} device{onlineDevices.length !== 1 ? 's' : ''} active in last 30 min</p>
                  {onlineDevices.map((d, i) => {
                    const minsAgo = Math.round((Date.now() - new Date(d.online_at).getTime()) / 60000)
                    return (
                      <div key={d.device_id ?? i} className="bg-white rounded-xl shadow-sm p-4">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex-1 min-w-0">
                            <p className="font-semibold text-gray-900 text-sm truncate">
                              {d.user_name ?? 'Unknown user'}
                            </p>
                            <p className="text-xs text-gray-400 truncate mt-0.5">
                              {d.device_name ? d.device_name.slice(0, 60) : d.device_id.slice(0, 12)}
                            </p>
                            <p className="text-xs text-gray-400 mt-0.5">
                              {minsAgo < 1 ? 'Just now' : `${minsAgo}m ago`}
                            </p>
                          </div>
                          <div className="text-right shrink-0">
                            {d.battery_level !== null && (
                              <div className="flex items-center gap-1 justify-end">
                                <div className="w-5 h-2.5 rounded-sm border border-gray-300 overflow-hidden">
                                  <div
                                    className={`h-full ${d.battery_level > 20 ? 'bg-green-500' : 'bg-red-500'}`}
                                    style={{ width: `${d.battery_level}%` }}
                                  />
                                </div>
                                <span className={`text-xs font-medium ${d.battery_level > 20 ? 'text-gray-600' : 'text-red-600'}`}>
                                  {d.battery_level}%
                                </span>
                              </div>
                            )}
                            <span className="inline-block mt-1 w-2 h-2 rounded-full bg-green-400" title="Online" />
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )
            )}

            {/* ── ANOMALIES TAB ────────────────────────────────────────────── */}
            {tab === 'anomalies' && (
              anomalyReadings.length === 0 ? (
                <div className="text-center py-16">
                  <div className="text-5xl mb-3">✓</div>
                  <p className="font-semibold text-gray-900">No anomalies</p>
                  <p className="text-sm text-gray-500 mt-1">All readings are within normal range</p>
                </div>
              ) : (() => {
                const anomalyReaders = [...new Set(anomalyReadings.map(r => r.read_by ?? 'Unknown'))]
                const filtered = anomalyReaderFilter === 'all'
                  ? anomalyReadings
                  : anomalyReadings.filter(r => (r.read_by ?? 'Unknown') === anomalyReaderFilter)
                return (
                <div className="space-y-3">
                  {/* Filter + export toolbar */}
                  <div className="flex items-center gap-2">
                    {anomalyReaders.length > 1 && (
                      <select
                        value={anomalyReaderFilter}
                        onChange={e => setAnomalyReaderFilter(e.target.value)}
                        className="flex-1 text-sm border border-gray-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-1 focus:ring-indigo-500 bg-white"
                      >
                        <option value="all">All readers</option>
                        {anomalyReaders.map(r => <option key={r} value={r}>{r}</option>)}
                      </select>
                    )}
                    <button
                      onClick={() => exportAnomalyCsv(anomalyReadings, period)}
                      className="text-indigo-600 active:text-indigo-800 shrink-0"
                      title="Export CSV"
                    >
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                          d="M12 10v6m0 0l-3-3m3 3l3-3M3 17V7a2 2 0 012-2h6l2 2h6a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
                      </svg>
                    </button>
                  </div>
                  <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide px-4 py-3">
                    {filtered.length} anomalous reading{filtered.length !== 1 ? 's' : ''}{anomalyReaderFilter !== 'all' ? ` · ${anomalyReaderFilter}` : ''}
                  </p>
                  <div className="divide-y divide-gray-50">
                    {filtered.map(r => (
                      <div key={r.id} className="px-4 py-3">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-sm font-semibold text-gray-900 truncate">{r.unit_label ?? '—'}</p>
                            <p className="text-xs text-gray-400">#{r.meter_number} · {r.read_by ?? 'Unknown reader'}</p>
                          </div>
                          <div className="text-right shrink-0">
                            <p className="text-sm font-bold text-orange-600">{Number(r.current_value).toLocaleString()}</p>
                            <p className="text-xs text-gray-400">+{Number(r.units_consumed).toFixed(1)} units</p>
                          </div>
                        </div>
                        <div className="flex gap-1.5 mt-1.5">
                          {r.anomaly  && <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-orange-100 text-orange-700">⚠ High consumption</span>}
                          {r.tampered && <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-red-100 text-red-700">Tampered/Fault</span>}
                          {r.notes?.includes('inaccessible') && <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-gray-100 text-gray-600">Inaccessible</span>}
                        </div>
                        {r.notes && !r.notes.includes('inaccessible') && (
                          <p className="text-xs text-gray-400 mt-1 truncate">{r.notes}</p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
                </div>
                )
              })()
            )}
          </>
        )}
      </div>
    </div>
  )
}

function exportProgressCsv(progress: ReadingProgress, period: string) {
  const rows = ['Reader,Readings']
  progress.by_reader.forEach(r => rows.push([
    `"${r.reader_name.replace(/"/g, '""')}"`, r.read_count,
  ].join(',')))
  rows.push(['"— TOTAL READ"', progress.total_read].join(','))
  rows.push(['"— UNREAD"', progress.total_unread].join(','))
  rows.push(['"— COMPLETION %"', Number(progress.completion_pct).toFixed(1)].join(','))
  const blob = new Blob([rows.join('\n')], { type: 'text/csv' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href = url; a.download = `progress-${period}.csv`; a.click()
  URL.revokeObjectURL(url)
}

function exportAnomalyCsv(readings: ReadMeter[], period: string) {
  const rows = ['Unit,Meter Number,Reading,Consumption,Reader,Date']
  readings.forEach(r => rows.push([
    `"${(r.unit_label ?? '').replace(/"/g, '""')}"`,
    r.meter_number,
    r.current_value,
    Number(r.units_consumed).toFixed(1),
    r.read_by ?? '',
    r.reading_date ?? '',
  ].join(',')))
  const blob = new Blob([rows.join('\n')], { type: 'text/csv' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href = url; a.download = `anomalies-${period}.csv`; a.click()
  URL.revokeObjectURL(url)
}

function exportUnreadCsv(meters: UnreadMeter[], period: string) {
  const rows = ['Unit Label,Meter Number,Utility Type,Last Reading,Last Reading Date']
  meters.forEach(m => rows.push([
    `"${(m.unit_label ?? '').replace(/"/g, '""')}"`,
    m.meter_number,
    m.utility_type.replace('_', ' '),
    m.last_reading ?? '',
    m.last_reading_date ?? '',
  ].join(',')))
  const blob = new Blob([rows.join('\n')], { type: 'text/csv' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href     = url
  a.download = `unread-meters-${period}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

function AssignTab({ period }: { period: string }) {
  const [summary, setSummary]   = useState<AssignmentPhase[]>([])
  const [readers, setReaders]   = useState<AvailableReader[]>([])
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState('')
  const [saving, setSaving]     = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [sum, rds] = await Promise.all([getAssignmentSummary(period), getAvailableReaders()])
      setSummary(sum)
      setReaders(rds)
      // Expand all phases by default
      setExpanded(new Set(sum.map(p => p.phase)))
    } catch {
      setError('Failed to load assignment data.')
    } finally {
      setLoading(false)
    }
  }, [period])

  useEffect(() => { void load() }, [load])

  async function handleAssign(block: string, readerId: string, readerName: string) {
    setSaving(block)
    try {
      if (!readerId) {
        await clearByBlock(period, block)
      } else {
        await assignByBlock(period, block, readerId, readerName)
      }
      await load()
    } catch { /* ignore */ }
    finally { setSaving(null) }
  }

  function togglePhase(phase: string) {
    setExpanded(s => {
      const n = new Set(s)
      n.has(phase) ? n.delete(phase) : n.add(phase)
      return n
    })
  }

  if (loading) return (
    <div className="flex justify-center py-16">
      <div className="w-8 h-8 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin" />
    </div>
  )
  if (error) return <div className="text-center py-12 text-gray-500">{error}</div>
  if (readers.length === 0) return (
    <div className="text-center py-12 text-gray-500 px-4">
      <p className="font-semibold text-gray-900 mb-1">No meter readers found</p>
      <p className="text-sm">Invite users with Meter Reader or Field Technician roles first.</p>
    </div>
  )

  return (
    <div className="space-y-3">
      {summary.map(phase => (
        <div key={phase.phase} className="bg-white rounded-2xl shadow-sm overflow-hidden">
          <button
            onClick={() => togglePhase(phase.phase)}
            className="w-full flex items-center justify-between px-4 py-3"
          >
            <div className="text-left">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">{phase.phase}</p>
              <p className="text-sm text-gray-600 mt-0.5">
                {phase.assigned_meters}/{phase.total_meters} meters assigned
              </p>
            </div>
            <svg
              className={`w-4 h-4 text-gray-400 transition-transform ${expanded.has(phase.phase) ? 'rotate-180' : ''}`}
              fill="none" stroke="currentColor" viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          {expanded.has(phase.phase) && (
            <div className="border-t border-gray-100 divide-y divide-gray-50">
              {phase.blocks.map(block => {
                const primaryReader = block.readers[0]
                const currentReaderId = primaryReader?.reader_user_id ?? ''
                return (
                  <div key={block.block} className="px-4 py-3 flex items-center gap-3">
                    <div className="w-10 h-10 bg-indigo-50 rounded-xl flex items-center justify-center shrink-0">
                      <span className="text-sm font-bold text-indigo-700">{block.block}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-gray-400">{block.assigned_meters}/{block.total_meters} meters</p>
                      {saving === block.block ? (
                        <p className="text-xs text-indigo-600 mt-1">Saving…</p>
                      ) : (
                        <select
                          value={currentReaderId}
                          onChange={e => {
                            const r = readers.find(r => r.id === e.target.value)
                            void handleAssign(block.block, e.target.value, r?.full_name ?? '')
                          }}
                          disabled={saving !== null}
                          className="mt-1 w-full text-sm border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:opacity-40"
                        >
                          <option value="">— Unassigned —</option>
                          {readers.map(r => (
                            <option key={r.id} value={r.id}>{r.full_name}</option>
                          ))}
                        </select>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      ))}
      {summary.length === 0 && (
        <div className="text-center py-12 text-gray-400 text-sm">No active consumer meters found.</div>
      )}
    </div>
  )
}

function StatRow({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="flex justify-between items-center">
      <span className="text-sm text-gray-500">{label}</span>
      <span className={`text-sm font-bold ${color ?? 'text-gray-900'}`}>{value}</span>
    </div>
  )
}

function AlertBadge({ label, color }: { label: string; color: 'orange' | 'red' }) {
  const cls = color === 'orange'
    ? 'bg-orange-50 text-orange-700 border-orange-200'
    : 'bg-red-50 text-red-700 border-red-200'
  return (
    <span className={`text-xs font-semibold border px-2.5 py-1 rounded-full ${cls}`}>{label}</span>
  )
}

function PerfBadge({ label, value, color }: { label: string; value: number; color?: string }) {
  const colorMap: Record<string, string> = {
    orange: 'text-orange-600',
    red:    'text-red-600',
    gray:   'text-gray-400',
  }
  return (
    <span className="text-xs text-gray-400">
      {label}: <span className={`font-semibold ${colorMap[color ?? ''] ?? 'text-gray-700'}`}>{value}</span>
    </span>
  )
}
