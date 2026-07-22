import { useState, useEffect } from 'react'
import { getReadingProgress, getReaderPerformance, getUnreadMeters, getAnomalyReadings, type ReadingProgress, type ReaderPerformance, type UnreadMeter, type ReadMeter } from '../api'

function formatPeriod(p: string): string {
  const [year, month] = p.split('-')
  return new Date(parseInt(year), parseInt(month) - 1, 1)
    .toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
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
  type DashTab = 'overview' | 'unread' | 'anomalies'

  const [tab, setTab]                   = useState<DashTab>('overview')
  const [progress, setProgress]         = useState<ReadingProgress | null>(null)
  const [performance, setPerformance]   = useState<ReaderPerformance[]>([])
  const [unreadMeters, setUnreadMeters] = useState<UnreadMeter[]>([])
  const [anomalyReadings, setAnomalyReadings] = useState<ReadMeter[]>([])
  const [loading, setLoading]           = useState(true)
  const [error, setError]               = useState('')
  const [refreshKey, setRefreshKey]     = useState(0)
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null)

  useEffect(() => {
    setLoading(true)
    setError('')
    Promise.all([
      getReadingProgress(period),
      getReaderPerformance(period),
      getUnreadMeters(period),
      getAnomalyReadings(period),
    ]).then(([prog, perf, unread, anomalies]) => {
      setProgress(prog)
      setPerformance(perf)
      setUnreadMeters(unread)
      setAnomalyReadings(anomalies)
      setLastRefreshed(new Date())
    }).catch(() => {
      setError('Failed to load supervisor data.')
    }).finally(() => setLoading(false))
  }, [period, refreshKey])

  return (
    <div className="flex flex-col min-h-screen bg-gray-50">

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
          { key: 'anomalies', label: `Anomalies${!loading && anomalyReadings.length > 0 ? ` (${anomalyReadings.length})` : ''}` },
        ] as { key: DashTab; label: string }[]).map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex-1 py-3 text-sm font-semibold border-b-2 transition-colors ${
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
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-4">Reading Progress</p>
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
                        <AlertBadge label={`${progress.tampered_count} tampered`} color="red" />
                      )}
                    </div>
                  )}
                </div>

                {progress.by_reader.length > 0 && (
                  <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
                    <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide px-4 py-3">By Reader</p>
                    <div className="divide-y divide-gray-50">
                      {progress.by_reader.map(r => (
                        <div key={r.reader_name} className="flex items-center justify-between px-4 py-3">
                          <span className="text-sm font-medium text-gray-700">{r.reader_name}</span>
                          <span className="text-sm font-bold text-indigo-600">{r.read_count} read</span>
                        </div>
                      ))}
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
              ) : (
                <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide px-4 py-3">
                    {unreadMeters.length} meter{unreadMeters.length !== 1 ? 's' : ''} not yet read
                  </p>
                  <div className="divide-y divide-gray-50">
                    {unreadMeters.map(m => (
                      <div key={m.id} className="flex items-center gap-3 px-4 py-3">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-gray-900 truncate">{m.unit_label}</p>
                          <p className="text-xs text-gray-400">#{m.meter_number} · {m.utility_type.replace('_', ' ')}</p>
                        </div>
                        <span className="text-xs text-gray-400 shrink-0">
                          Prev: {m.last_reading ?? '—'}
                        </span>
                      </div>
                    ))}
                  </div>
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
              ) : (
                <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide px-4 py-3">
                    {anomalyReadings.length} anomalous reading{anomalyReadings.length !== 1 ? 's' : ''}
                  </p>
                  <div className="divide-y divide-gray-50">
                    {anomalyReadings.map(r => (
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
              )
            )}
          </>
        )}
      </div>
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
