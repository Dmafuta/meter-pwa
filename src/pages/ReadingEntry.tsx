import { useState, useRef, useEffect, useMemo } from 'react'
import { submitReading, getReadingHistory, initiateCall, type UnreadMeter, type MeterReadingHistory } from '../api'
import { queueReading, loadHistoryCache, loadMeterCache, saveMeterCache } from '../db'

// ── Quick-pick note templates ─────────────────────────────────────────────────
const NOTE_TEMPLATES = [
  'Meter damaged',
  'No access – gate locked',
  'Reading unclear',
  'Suspected leak',
  'Seal broken',
  'Dog on premises',
]

// ── Photo compression ─────────────────────────────────────────────────────────
async function compressPhoto(dataUrl: string): Promise<string> {
  return new Promise(resolve => {
    const img = new Image()
    img.onload = () => {
      const MAX = 800
      const ratio = Math.min(MAX / img.width, MAX / img.height, 1)
      const canvas = document.createElement('canvas')
      canvas.width  = Math.round(img.width  * ratio)
      canvas.height = Math.round(img.height * ratio)
      canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height)
      resolve(canvas.toDataURL('image/jpeg', 0.6))
    }
    img.src = dataUrl
  })
}

function formatPeriod(p: string): string {
  const [year, month] = p.split('-')
  return new Date(parseInt(year), parseInt(month) - 1, 1)
    .toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
}

function formatPeriodShort(p: string | null): string {
  if (!p) return '—'
  const [year, month] = p.split('-')
  return new Date(parseInt(year), parseInt(month) - 1, 1)
    .toLocaleDateString('en-US', { month: 'short', year: '2-digit' })
}

function beep() {
  try {
    const ctx = new AudioContext()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.connect(gain); gain.connect(ctx.destination)
    osc.frequency.value = 880; gain.gain.value = 0.08
    osc.start()
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15)
    osc.stop(ctx.currentTime + 0.15)
  } catch { /* ignore — AudioContext may be blocked */ }
}

export default function ReadingEntry({
  meter,
  period,
  nextMeter,
  meterIndex,
  totalMeters,
  onSubmitted,
  onBack,
}: {
  meter: UnreadMeter
  period: string
  nextMeter?: UnreadMeter | null
  meterIndex?: number
  totalMeters?: number
  onSubmitted: () => void
  onBack: () => void
}) {
  // ── Draft persistence ───────────────────────────────────────────────────────
  const draftKey = `draft_${meter.id}_${period}`
  const initDraft = (): Record<string, unknown> => {
    try { return JSON.parse(localStorage.getItem(draftKey) ?? 'null') ?? {} } catch { return {} }
  }
  const d = initDraft()

  const [currentValue, setCurrentValue]     = useState(() => String(d.currentValue ?? ''))
  const [notes, setNotes]                   = useState(() => String(d.notes ?? ''))
  const [showNotes, setShowNotes]           = useState(() => Boolean(d.notes))
  const [sealNumber, setSealNumber]         = useState(() => String(d.sealNumber ?? ''))
  const [tampered, setTampered]             = useState(() => Boolean(d.tampered ?? false))
  const [photo, setPhoto]                   = useState<string | null>(null)
  const [loading, setLoading]               = useState(false)
  const [error, setError]                   = useState('')
  const [success, setSuccess]               = useState(false)
  const [gps, setGps]                       = useState<{ lat: number; lng: number; accuracy: number } | null>(null)
  const [showInaccessible, setShowInaccessible] = useState(false)
  const [showConfirm, setShowConfirm]       = useState(false)
  const [history, setHistory]               = useState<MeterReadingHistory[]>([])
  const [showHistory, setShowHistory]       = useState(false)
  const [storageWarning, setStorageWarning] = useState(false)
  const [listening, setListening]           = useState(false)
  const [flagReview, setFlagReview]         = useState(false)
  const [photoScale, setPhotoScale]         = useState(1)
  const [callStatus, setCallStatus]         = useState<'idle' | 'calling' | 'ok' | 'err'>('idle')
  const [callMessage, setCallMessage]       = useState('')
  const photoInputRef   = useRef<HTMLInputElement>(null)
  const advancedRef     = useRef(false)
  const touchStartXRef  = useRef(0)
  const pinchRef        = useRef({ startDist: 0, startScale: 1 })

  // ── Auto-flag tampered for meters under investigation ─────────────────────
  useEffect(() => {
    if (meter.status === 'under_investigation') setTampered(true)
  }, [meter.status])

  // ── Screen Wake Lock — keep display on while reading ──────────────────────
  useEffect(() => {
    type WakeLockSentinel = { released: boolean; release(): Promise<void> }
    type WakeLockApi = { request(type: 'screen'): Promise<WakeLockSentinel> }
    const nav = navigator as Navigator & { wakeLock?: WakeLockApi }
    if (!nav.wakeLock) return

    let sentinel: WakeLockSentinel | null = null

    async function acquire() {
      try { sentinel = await nav.wakeLock!.request('screen') }
      catch { /* permission denied or not supported */ }
    }

    // Re-acquire when tab becomes visible again
    function handleVisibility() {
      if (!document.hidden && (!sentinel || sentinel.released)) void acquire()
    }

    void acquire()
    document.addEventListener('visibilitychange', handleVisibility)
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility)
      sentinel?.release().catch(() => {})
    }
  }, [])

  // Call-once wrapper so swipe and the scheduled timeout don't both fire
  function doAdvance() {
    if (advancedRef.current) return
    advancedRef.current = true
    onSubmitted()
  }

  // Save draft whenever fields change
  useEffect(() => {
    if (success) return
    const data: Record<string, unknown> = {}
    if (currentValue) data.currentValue = currentValue
    if (notes)        data.notes        = notes
    if (sealNumber)   data.sealNumber   = sealNumber
    if (tampered)     data.tampered     = tampered
    if (Object.keys(data).length > 0) {
      localStorage.setItem(draftKey, JSON.stringify(data))
    } else {
      localStorage.removeItem(draftKey)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentValue, notes, sealNumber, tampered, success])

  // GPS on mount (with accuracy)
  useEffect(() => {
    if (!navigator.geolocation) return
    navigator.geolocation.getCurrentPosition(
      pos => setGps({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy }),
      () => {},
      { timeout: 8000, maximumAge: 60000 }
    )
  }, [])

  // Reading history — hydrate from IndexedDB first, then update from network
  useEffect(() => {
    loadHistoryCache(meter.id)
      .then(cached => { if (cached && cached.length > 0) setHistory(cached as MeterReadingHistory[]) })
      .catch(() => {})
    getReadingHistory(meter.id).then(setHistory).catch(() => {})
  }, [meter.id])

  // Prefetch next meter's history while user reviews current reading
  useEffect(() => {
    if (nextMeter) getReadingHistory(nextMeter.id).catch(() => {})
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nextMeter?.id])

  // Electricity and gas meters show decimals; water meters are whole-number
  const isDecimalMeter = meter.utility_type === 'electricity' || meter.utility_type === 'gas'

  const current     = currentValue !== '' ? parseFloat(currentValue) : NaN
  const prev        = meter.last_reading ?? 0
  const consumption = !isNaN(current) ? Math.max(0, current - prev) : null

  // Average of last 5 non-zero, non-estimated readings — for anomaly detection
  const avgConsumption = useMemo(() => {
    const relevant = history
      .filter(r => r.units_consumed > 0 && r.source !== 'estimated')
      .slice(0, 5)
    if (relevant.length < 2) return null
    return relevant.reduce((s, r) => s + r.units_consumed, 0) / relevant.length
  }, [history])

  const isAnomaly = consumption !== null &&
    avgConsumption !== null &&
    avgConsumption > 0 &&
    consumption > avgConsumption * 2

  const isDuplicate = !isNaN(current) &&
    meter.last_reading !== null &&
    current === meter.last_reading

  // ── Photo ────────────────────────────────────────────────────────────────────
  async function handlePhotoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = async () => {
      const compressed = await compressPhoto(reader.result as string)
      setPhoto(compressed)
      // Check storage quota
      if (navigator.storage?.estimate) {
        navigator.storage.estimate().then(({ usage = 0, quota = 1 }) => {
          if (usage / quota > 0.8) setStorageWarning(true)
        }).catch(() => {})
      }
    }
    reader.readAsDataURL(file)
  }

  const skipConfirm = localStorage.getItem('pwa_skip_confirm') === '1'
  const soundOn     = localStorage.getItem('pwa_sound') !== '0'  // on by default

  // ── Voice input ──────────────────────────────────────────────────────────────
  const hasSpeech = 'SpeechRecognition' in window || 'webkitSpeechRecognition' in window
  function startVoice() {
    const w = window as unknown as Record<string, unknown>
    const SR = (w.SpeechRecognition ?? w.webkitSpeechRecognition) as (new () => {
      lang: string; interimResults: boolean; maxAlternatives: number
      onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null
      onerror: (() => void) | null; onend: (() => void) | null; start(): void
    }) | undefined
    if (!SR) return
    const recog = new SR()
    recog.lang = 'en-US'; recog.interimResults = false; recog.maxAlternatives = 1
    setListening(true)
    recog.onresult = e => {
      const spoken = e.results[0][0].transcript.replace(/[^0-9.]/g, '')
      if (spoken) { setCurrentValue(spoken); setError('') }
      setListening(false)
    }
    recog.onerror = () => setListening(false)
    recog.onend   = () => setListening(false)
    recog.start()
  }

  // ── Pinch-to-zoom helpers ─────────────────────────────────────────────────────
  function getPinchDist(e: React.TouchEvent) {
    if (e.touches.length < 2) return 0
    return Math.hypot(e.touches[1].clientX - e.touches[0].clientX, e.touches[1].clientY - e.touches[0].clientY)
  }

  const isUnderInvestigation = meter.status === 'under_investigation'

  // ── Submit → open confirmation (or skip if preference set) ──────────────────
  function handleSubmitClick(e: React.FormEvent) {
    e.preventDefault()
    if (isNaN(current)) { setError('Enter a valid reading'); return }
    if (meter.last_reading !== null && current < meter.last_reading) {
      setError(`Reading (${current}) is less than previous (${meter.last_reading})`)
      return
    }
    if (isUnderInvestigation && !photo) {
      setError('Photo is required — this meter is under investigation')
      return
    }
    setError('')
    // Skip confirm sheet for normal readings when user has opted in
    if (skipConfirm && !isAnomaly && !isUnderInvestigation) {
      void confirmSubmit()
    } else {
      setShowConfirm(true)
    }
  }

  // ── Actual submission ────────────────────────────────────────────────────────
  async function confirmSubmit() {
    setLoading(true)
    setError('')
    const effectiveNotes = [notes || '', flagReview ? 'Flagged for supervisor review' : ''].filter(Boolean).join('; ') || undefined
    try {
      await submitReading(meter.id, current, period, photo ?? undefined, effectiveNotes,
        gps?.lat, gps?.lng, sealNumber || undefined, tampered || undefined)
      localStorage.removeItem(draftKey)
      setSuccess(true)
      navigator.vibrate?.(100)
      if (soundOn) beep()
      setShowConfirm(false)
      setTimeout(doAdvance, 1200)
    } catch (err) {
      const isOffline = !navigator.onLine || String(err).includes('Failed to fetch')
      if (isOffline) {
        await queueReading({
          meterId: meter.id, meterNumber: meter.meter_number, unitLabel: meter.unit_label,
          currentValue: current, billingPeriod: period,
          photoBase64: photo ?? undefined, notes: effectiveNotes,
          latitude: gps?.lat, longitude: gps?.lng,
          sealNumber: sealNumber || undefined, tampered: tampered || undefined,
          queuedAt: Date.now(),
        })
        // Immediately remove this meter from the cached list so it won't reappear
        // on return to the meter list while still offline
        loadMeterCache(period).then(cached => {
          if (cached) {
            const updated = (cached.meters as { id: string }[]).filter(m => m.id !== meter.id)
            void saveMeterCache(period, updated)
          }
        }).catch(() => {})
        localStorage.removeItem(draftKey)
        setSuccess(true)
        navigator.vibrate?.(200)
        if (soundOn) beep()
        setShowConfirm(false)
        setTimeout(doAdvance, 1200)
      } else {
        setError(err instanceof Error ? err.message : 'Failed to submit reading')
        setShowConfirm(false)
      }
      setLoading(false)
    }
  }

  // ── Inaccessible ─────────────────────────────────────────────────────────────
  async function handleInaccessible() {
    setShowInaccessible(false)
    setLoading(true)
    setError('')
    const value = meter.last_reading ?? 0
    const inaccessibleNote = notes.trim() ? `Meter inaccessible — ${notes.trim()}` : 'Meter inaccessible'
    try {
      await submitReading(meter.id, value, period, undefined, inaccessibleNote, gps?.lat, gps?.lng)
      setSuccess(true)
      navigator.vibrate?.(100)
      setTimeout(doAdvance, 1200)
    } catch (err) {
      const isOffline = !navigator.onLine || String(err).includes('Failed to fetch')
      if (isOffline) {
        await queueReading({
          meterId: meter.id, meterNumber: meter.meter_number, unitLabel: meter.unit_label,
          currentValue: value, billingPeriod: period, notes: inaccessibleNote,
          latitude: gps?.lat, longitude: gps?.lng, queuedAt: Date.now(),
        })
        setSuccess(true)
        navigator.vibrate?.(200)
        setTimeout(doAdvance, 1200)
      } else {
        setError(err instanceof Error ? err.message : 'Failed to submit')
      }
      setLoading(false)
    }
  }

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <div
      className="flex flex-col min-h-screen bg-gray-50"
      onTouchStart={e => { touchStartXRef.current = e.touches[0].clientX }}
      onTouchEnd={e => {
        if (!success || !nextMeter) return
        const dx = touchStartXRef.current - e.changedTouches[0].clientX
        if (dx > 60) doAdvance()
      }}
    >

      {/* ── Confirmation overlay ──────────────────────────────────────────────── */}
      {showConfirm && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-end">
          <div className="bg-white rounded-t-3xl w-full p-5 space-y-4 pb-8">
            <div className="w-10 h-1 bg-gray-200 rounded-full mx-auto mb-1" />
            <h2 className="text-lg font-bold text-gray-900">Confirm Reading</h2>

            <div className="bg-gray-50 rounded-2xl p-4 space-y-2.5">
              <Row label="Unit"       value={meter.unit_label} bold />
              <Row label="Meter"      value={`#${meter.meter_number}`} />
              <Row label="Previous"   value={prev.toLocaleString()} />
              <div className="border-t border-gray-200 pt-2.5">
                <Row label="New reading" value={current.toLocaleString()} bold large />
                <Row
                  label="Consumption"
                  value={`${consumption?.toFixed(1)} units`}
                  color={isAnomaly ? 'text-orange-600' : 'text-green-700'}
                />
              </div>
            </div>

            {isAnomaly && (
              <div className="bg-orange-50 border border-orange-200 rounded-2xl p-3.5">
                <p className="text-sm font-bold text-orange-800">⚠ Unusually high consumption</p>
                <p className="text-xs text-orange-700 mt-1">
                  {consumption?.toFixed(1)} units recorded vs typical {avgConsumption?.toFixed(1)} units.
                  Please verify the meter display before confirming.
                </p>
              </div>
            )}

            {sealNumber.trim() && (
              <div className="bg-gray-50 rounded-xl px-3 py-2">
                <p className="text-xs text-gray-600 font-medium">Seal: {sealNumber.trim()}</p>
              </div>
            )}
            {tampered && (
              <div className="bg-red-50 border border-red-200 rounded-xl px-3 py-2">
                <p className="text-xs text-red-700 font-bold">Tamper/Fault flagged</p>
              </div>
            )}
            {notes.trim() && (
              <div className="bg-blue-50 rounded-xl px-3 py-2">
                <p className="text-xs text-blue-700 font-medium">Note: {notes.trim()}</p>
              </div>
            )}

            {photo && (
              <img src={photo} alt="Meter" className="w-full h-28 object-cover rounded-xl" />
            )}

            <div className="flex gap-3 pt-1">
              <button
                onClick={() => setShowConfirm(false)}
                className="flex-1 border-2 border-gray-200 text-gray-700 rounded-2xl py-3.5 font-semibold"
              >
                Edit
              </button>
              <button
                onClick={() => void confirmSubmit()}
                disabled={loading}
                className={`flex-1 text-white rounded-2xl py-3.5 font-semibold disabled:opacity-50 ${
                  isAnomaly ? 'bg-orange-500 active:bg-orange-600' : 'bg-green-600 active:bg-green-700'
                }`}
              >
                {loading
                ? (photo ? 'Uploading…' : 'Submitting…')
                : isAnomaly ? 'Submit Anyway' : 'Confirm'
              }
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Header ───────────────────────────────────────────────────────────── */}
      <div className="bg-green-600 text-white px-4 pt-12 pb-5">
        <div className="flex items-center justify-between mb-2">
          <button onClick={onBack} className="flex items-center gap-1 text-green-200 text-sm active:text-white">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Back to list
          </button>
          {meterIndex !== undefined && totalMeters !== undefined && totalMeters > 0 && (
            <span className="text-green-300 text-xs font-medium">
              {meterIndex + 1} / {totalMeters}
            </span>
          )}
        </div>
        {meterIndex !== undefined && totalMeters !== undefined && totalMeters > 0 && (
          <div className="w-full bg-white/20 rounded-full h-1 mb-3">
            <div
              className="bg-white rounded-full h-1 transition-all"
              style={{ width: `${Math.round((meterIndex / totalMeters) * 100)}%` }}
            />
          </div>
        )}
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-bold">{meter.unit_label}</h1>
          {meter.meter_type === 'smart' && (
            <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-white/20 text-white">Smart</span>
          )}
        </div>
        <p className="text-green-200 text-sm mt-0.5">
          #{meter.meter_number} · {formatPeriod(period)}
          {gps && <span className="ml-2 text-green-300">· GPS ✓{gps.accuracy ? ` ±${Math.round(gps.accuracy)}m` : ''}</span>}
        </p>
        {meter.meter_type === 'smart' && (
          <p className="text-green-300 text-xs mt-0.5">AMR / Auto-read meter — confirm display value</p>
        )}
      </div>

      <div className="flex-1 px-4 py-5 space-y-4 pb-10">

        {/* ── Under investigation banner ────────────────────────────────────── */}
        {isUnderInvestigation && (
          <div className="bg-amber-50 border border-amber-300 rounded-2xl px-4 py-3 flex items-start gap-3">
            <span className="text-xl mt-0.5">⚠️</span>
            <div>
              <p className="text-sm font-bold text-amber-800">Meter Under Investigation</p>
              {meter.investigation_reason && (
                <p className="text-xs text-amber-700 mt-0.5">{meter.investigation_reason}</p>
              )}
              <p className="text-xs text-amber-700 mt-1 font-medium">Photo is mandatory for this reading.</p>
            </div>
          </div>
        )}

        {/* ── Previous reading card ─────────────────────────────────────────── */}
        <div className="bg-white rounded-2xl shadow-sm px-4 py-4">
          <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-1">Previous Reading</p>
          <p className="text-4xl font-bold text-gray-900">
            {meter.last_reading !== null ? meter.last_reading.toLocaleString() : '—'}
          </p>
          <p className="text-sm text-gray-400 mt-1">
            {meter.last_reading_date ? `Read on ${meter.last_reading_date}` : 'Never read'}
            {' · '}
            <span className="capitalize">{meter.utility_type.replace('_', ' ')}</span>
          </p>

          {history.length >= 2 && (
            <div className="mt-3 pt-3 border-t border-gray-100">
              <p className="text-xs text-gray-400 mb-1.5">Last {Math.min(history.length, 6)} readings</p>
              <Sparkline data={history.slice(0, 6).reverse()} />
            </div>
          )}

          {consumption !== null && (
            <div className="mt-3 pt-3 border-t border-gray-100 flex justify-between items-center">
              <span className="text-sm text-gray-500">Consumption</span>
              <div className="text-right">
                <span className={`text-sm font-semibold ${
                  isAnomaly ? 'text-orange-500' : consumption > 0 ? 'text-green-700' : 'text-gray-400'
                }`}>
                  {consumption.toFixed(3)} units{isAnomaly && ' ⚠'}
                </span>
                {avgConsumption !== null && (
                  <p className="text-xs text-gray-400">typical: {avgConsumption.toFixed(1)}</p>
                )}
              </div>
            </div>
          )}
        </div>

        {/* ── Reading form ─────────────────────────────────────────────────── */}
        <form onSubmit={handleSubmitClick} className="bg-white rounded-2xl shadow-sm p-5 space-y-4">
          {error && (
            <div className="bg-red-50 border border-red-100 text-red-700 text-sm rounded-xl p-3">{error}</div>
          )}

          {/* Reading input */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">Current Reading</label>
            <div className="relative">
              <input
                type="number"
                inputMode={isDecimalMeter ? 'decimal' : 'numeric'}
                step={isDecimalMeter ? '0.001' : '1'}
                value={currentValue}
                onChange={e => { setCurrentValue(e.target.value); setError('') }}
                aria-label="Current meter reading"
                className="w-full border-2 border-gray-200 rounded-xl px-4 py-4 text-3xl font-bold text-center text-gray-900 focus:outline-none focus:border-green-500 transition-colors"
                placeholder={isDecimalMeter ? '0.000' : '0'}
                required
                autoFocus
              />
              {hasSpeech && (
                <button
                  type="button"
                  onClick={startVoice}
                  disabled={listening}
                  className="absolute right-3 top-1/2 -translate-y-1/2 w-9 h-9 flex items-center justify-center rounded-full bg-gray-100 active:bg-gray-200 disabled:opacity-50"
                  title="Speak reading"
                >
                  {listening
                    ? <span className="w-3 h-3 bg-red-500 rounded-full animate-pulse" />
                    : <svg className="w-5 h-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                      </svg>
                  }
                </button>
              )}
            </div>
            {/* Nudge buttons */}
            {!isNaN(current) && (
              <div className="flex items-center gap-1.5 mt-2">
                {(isDecimalMeter ? [-0.1, -0.01, +0.01, +0.1] : [-10, -1, +1, +10]).map(n => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => {
                      const next = isDecimalMeter
                        ? parseFloat((current + n).toFixed(3))
                        : Math.round(current + n)
                      setCurrentValue(String(next < 0 ? 0 : next))
                      setError('')
                    }}
                    className="flex-1 py-1.5 text-xs font-semibold text-gray-600 bg-gray-100 rounded-lg active:bg-gray-200"
                  >
                    {n > 0 ? `+${n}` : n}
                  </button>
                ))}
              </div>
            )}
            {!isNaN(current) && meter.last_reading !== null && current < meter.last_reading && (
              <p className="text-yellow-700 text-xs bg-yellow-50 border border-yellow-200 rounded-lg px-3 py-2 mt-2">
                ⚠ Reading ({current}) is below the previous ({meter.last_reading}). Please verify the meter display.
              </p>
            )}
            {isDuplicate && (
              <p className="text-blue-700 text-xs bg-blue-50 border border-blue-200 rounded-lg px-3 py-2 mt-2">
                Same as previous reading. Confirm if the meter has not changed this period.
              </p>
            )}
            {Boolean(d.currentValue) && currentValue === String(d.currentValue) && (
              <p className="text-indigo-600 text-xs mt-1">Draft restored</p>
            )}
          </div>

          {/* Photo */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              Meter Photo <span className="font-normal text-gray-400">(optional)</span>
            </label>
            <input
              ref={photoInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={e => void handlePhotoChange(e)}
            />
            {photo ? (
              <div className="relative overflow-hidden rounded-xl">
                <img
                  src={photo}
                  alt="Meter"
                  className="w-full h-40 object-cover"
                  style={{ transform: `scale(${photoScale})`, transformOrigin: 'center', transition: photoScale === 1 ? 'transform 0.2s' : 'none', touchAction: 'none' }}
                  onTouchStart={e => {
                    if (e.touches.length === 2) pinchRef.current = { startDist: getPinchDist(e), startScale: photoScale }
                  }}
                  onTouchMove={e => {
                    if (e.touches.length === 2 && pinchRef.current.startDist > 0) {
                      const scale = Math.max(1, Math.min(4, pinchRef.current.startScale * getPinchDist(e) / pinchRef.current.startDist))
                      setPhotoScale(scale)
                    }
                  }}
                  onTouchEnd={() => { if (photoScale < 1.15) setPhotoScale(1) }}
                />
                <button
                  type="button"
                  onClick={() => { setPhoto(null); if (photoInputRef.current) photoInputRef.current.value = '' }}
                  className="absolute top-2 right-2 bg-black/50 text-white text-xs px-2 py-1 rounded-lg"
                >
                  Remove
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => photoInputRef.current?.click()}
                className="w-full border-2 border-dashed border-gray-200 rounded-xl py-5 flex flex-col items-center gap-1.5 text-gray-400 active:border-green-400 active:text-green-600 transition-colors"
              >
                <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                    d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                <span className="text-sm">Take photo</span>
              </button>
            )}
          </div>

          {storageWarning && (
            <div className="bg-orange-50 border border-orange-200 rounded-xl px-3 py-2">
              <p className="text-xs text-orange-700 font-medium">⚠ Device storage is nearly full. Sync offline readings to free space.</p>
            </div>
          )}

          {/* Seal number */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              Seal Number <span className="font-normal text-gray-400">(optional)</span>
            </label>
            <input
              type="text"
              value={sealNumber}
              onChange={e => setSealNumber(e.target.value)}
              placeholder="e.g. SL-2024-001"
              className="w-full border-2 border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:border-green-500"
            />
          </div>

          {/* Tamper flag */}
          <button
            type="button"
            onClick={() => setTampered(v => !v)}
            className={`w-full flex items-center gap-3 rounded-xl px-4 py-3 border-2 transition-colors ${
              tampered
                ? 'bg-red-50 border-red-400 text-red-700'
                : 'bg-gray-50 border-gray-200 text-gray-500'
            }`}
          >
            <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <div className="text-left">
              <p className="text-sm font-semibold">{tampered ? 'Tamper/Fault Flagged' : 'Flag as Tampered / Faulty'}</p>
              {tampered && <p className="text-xs mt-0.5">Supervisor will be notified for inspection</p>}
            </div>
          </button>

          {/* Flag for review — lighter than tampered */}
          <button
            type="button"
            onClick={() => setFlagReview(v => !v)}
            className={`w-full flex items-center gap-3 rounded-xl px-4 py-3 border-2 transition-colors ${
              flagReview
                ? 'bg-yellow-50 border-yellow-400 text-yellow-700'
                : 'bg-gray-50 border-gray-200 text-gray-500'
            }`}
          >
            <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M3 21v-4m0 0V5a2 2 0 012-2h6.5l1 1H21l-3 6 3 6h-8.5l-1-1H5a2 2 0 00-2 2zm9-13.5V9" />
            </svg>
            <div className="text-left">
              <p className="text-sm font-semibold">
                {flagReview ? 'Flagged for Review' : 'Flag for Supervisor Review'}
              </p>
              {flagReview && <p className="text-xs mt-0.5">Supervisor will inspect this reading</p>}
            </div>
          </button>

          {/* Notes — always available, collapsible */}
          {showNotes ? (
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">Note</label>
              <div className="flex flex-wrap gap-1.5 mb-2">
                {NOTE_TEMPLATES.map(t => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setNotes(n => n ? `${n}; ${t}` : t)}
                    className="text-xs bg-gray-100 text-gray-600 px-2.5 py-1 rounded-full active:bg-gray-200 shrink-0"
                  >
                    {t}
                  </button>
                ))}
              </div>
              <textarea
                value={notes}
                onChange={e => setNotes(e.target.value)}
                placeholder="e.g. damaged display, suspected leak, seal broken, tampered..."
                className="w-full border-2 border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:border-green-500 resize-none"
                rows={2}
              />
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setShowNotes(true)}
              className="flex items-center gap-1.5 text-sm text-gray-400 active:text-green-600"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              Add note
            </button>
          )}

          {!navigator.onLine && (
            <p className="text-center text-xs text-orange-600 font-medium">
              Offline — reading will be saved and synced when connected
            </p>
          )}

          {success ? (
            <div className="flex items-center justify-center gap-2 bg-green-50 border border-green-200 text-green-700 rounded-xl py-3 font-semibold text-sm">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              {nextMeter ? `Saved! Next: ${nextMeter.unit_label}` : 'Reading saved!'}
            </div>
          ) : (
            <button
              type="submit"
              disabled={loading || currentValue === ''}
              className="w-full bg-green-600 text-white rounded-xl py-4 font-semibold text-lg disabled:opacity-50 active:bg-green-700 transition-colors"
            >
              Submit Reading
            </button>
          )}
        </form>

        {/* ── Reading history ──────────────────────────────────────────────── */}
        {history.length > 0 && (
          <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
            <button
              onClick={() => setShowHistory(v => !v)}
              className="w-full flex items-center justify-between px-4 py-3 text-sm font-semibold text-gray-600"
            >
              <span>Reading History</span>
              <svg className={`w-4 h-4 text-gray-400 transition-transform ${showHistory ? 'rotate-180' : ''}`}
                fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            {showHistory && (
              <div className="border-t border-gray-100 divide-y divide-gray-50">
                {history.slice(0, 8).map((r, i) => (
                  <div key={r.id ?? i} className="flex items-center px-4 py-2.5">
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-gray-400">{formatPeriodShort(r.billing_period)}</p>
                      <p className="text-sm font-bold text-gray-900">{Number(r.current_value).toLocaleString()}</p>
                    </div>
                    <div className="text-right">
                      <p className={`text-sm font-semibold ${r.units_consumed > 0 ? 'text-gray-700' : 'text-gray-300'}`}>
                        {r.units_consumed > 0 ? `${Number(r.units_consumed).toFixed(1)} units` : '—'}
                      </p>
                      <p className="text-xs text-gray-400 capitalize">{r.source ?? 'manual'}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── Call owner ───────────────────────────────────────────────────── */}
        {meter.billing_person_phone && (
          <div className="bg-white rounded-2xl shadow-sm p-4 space-y-2">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Unit Contact</p>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold text-gray-900">{meter.billing_person_name ?? 'Occupant'}</p>
                <p className="text-xs text-gray-400">{meter.billing_person_phone}</p>
              </div>
              <button
                type="button"
                disabled={callStatus === 'calling'}
                onClick={async () => {
                  setCallStatus('calling')
                  setCallMessage('')
                  try {
                    const res = await initiateCall({
                      unit_id:   meter.unit_id,
                      meter_id:  meter.id,
                      unit_label: meter.unit_label,
                    })
                    if (res.status === 'initiated') {
                      setCallStatus('ok')
                      setCallMessage('Call connected via 3CX')
                    } else {
                      setCallStatus('err')
                      setCallMessage(res.message ?? 'Call failed')
                    }
                  } catch (e) {
                    setCallStatus('err')
                    setCallMessage(e instanceof Error ? e.message : 'Call failed')
                  }
                }}
                className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold transition-colors disabled:opacity-50 ${
                  callStatus === 'ok'
                    ? 'bg-green-100 text-green-700'
                    : callStatus === 'err'
                    ? 'bg-red-100 text-red-700'
                    : 'bg-blue-600 text-white active:bg-blue-700'
                }`}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                </svg>
                {callStatus === 'calling' ? 'Calling…'
                  : callStatus === 'ok'   ? 'Called ✓'
                  : callStatus === 'err'  ? 'Retry'
                  : 'Call owner'}
              </button>
            </div>
            {callMessage && (
              <p className={`text-xs px-1 ${callStatus === 'ok' ? 'text-green-700' : 'text-red-600'}`}>
                {callMessage}
              </p>
            )}
          </div>
        )}

        {/* ── Inaccessible ─────────────────────────────────────────────────── */}
        {!success && (
          showInaccessible ? (
            <div className="bg-orange-50 border border-orange-200 rounded-2xl p-4 space-y-3">
              <p className="text-sm font-semibold text-orange-800">Mark as inaccessible?</p>
              <p className="text-xs text-orange-700">
                Records the previous reading ({meter.last_reading ?? 0}) with an inaccessible note.
                {notes.trim() && ` Your note "${notes.trim()}" will be included.`}
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => void handleInaccessible()}
                  className="flex-1 bg-orange-500 text-white rounded-xl py-2.5 text-sm font-semibold active:bg-orange-600"
                >
                  Confirm
                </button>
                <button
                  onClick={() => setShowInaccessible(false)}
                  className="flex-1 bg-white border border-gray-200 text-gray-700 rounded-xl py-2.5 text-sm font-semibold"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setShowInaccessible(true)}
              className="w-full text-sm text-gray-400 py-2 active:text-orange-500"
            >
              Can't access this meter?
            </button>
          )
        )}
      </div>
    </div>
  )
}

// ── Mini sparkline bar chart ──────────────────────────────────────────────────
function Sparkline({ data }: { data: MeterReadingHistory[] }) {
  const values = data.map(r => Number(r.units_consumed))
  const max = Math.max(...values, 1)
  return (
    <div className="flex items-end gap-1 h-8">
      {values.map((v, i) => (
        <div key={i} className="flex-1 flex flex-col items-center gap-0.5">
          <div
            className="w-full rounded-sm bg-green-400 opacity-80"
            style={{ height: `${Math.max(4, Math.round((v / max) * 28))}px` }}
            title={`${v.toFixed(1)} units`}
          />
        </div>
      ))}
    </div>
  )
}

// ── Small helper ──────────────────────────────────────────────────────────────
function Row({
  label, value, bold, large, color,
}: {
  label: string; value: string; bold?: boolean; large?: boolean; color?: string
}) {
  return (
    <div className="flex justify-between items-baseline">
      <span className="text-sm text-gray-500">{label}</span>
      <span className={`${bold ? 'font-bold' : 'font-medium'} ${large ? 'text-xl' : 'text-sm'} ${color ?? 'text-gray-900'}`}>
        {value}
      </span>
    </div>
  )
}
