import { useState, useRef, useEffect, useMemo } from 'react'
import { submitReading, getReadingHistory, type UnreadMeter, type MeterReadingHistory } from '../api'
import { queueReading } from '../db'

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

export default function ReadingEntry({
  meter,
  period,
  nextMeter,
  onSubmitted,
  onBack,
}: {
  meter: UnreadMeter
  period: string
  nextMeter?: UnreadMeter | null
  onSubmitted: () => void
  onBack: () => void
}) {
  const [currentValue, setCurrentValue]     = useState('')
  const [notes, setNotes]                   = useState('')
  const [showNotes, setShowNotes]           = useState(false)
  const [sealNumber, setSealNumber]         = useState('')
  const [tampered, setTampered]             = useState(false)
  const [photo, setPhoto]                   = useState<string | null>(null)
  const [loading, setLoading]               = useState(false)
  const [error, setError]                   = useState('')
  const [success, setSuccess]               = useState(false)
  const [gps, setGps]                       = useState<{ lat: number; lng: number } | null>(null)
  const [showInaccessible, setShowInaccessible] = useState(false)
  const [showConfirm, setShowConfirm]       = useState(false)
  const [history, setHistory]               = useState<MeterReadingHistory[]>([])
  const [showHistory, setShowHistory]       = useState(false)
  const photoInputRef = useRef<HTMLInputElement>(null)

  // GPS on mount
  useEffect(() => {
    if (!navigator.geolocation) return
    navigator.geolocation.getCurrentPosition(
      pos => setGps({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => {},
      { timeout: 8000, maximumAge: 60000 }
    )
  }, [])

  // Reading history
  useEffect(() => {
    getReadingHistory(meter.id).then(setHistory).catch(() => {})
  }, [meter.id])

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

  // ── Photo ────────────────────────────────────────────────────────────────────
  async function handlePhotoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = async () => {
      const compressed = await compressPhoto(reader.result as string)
      setPhoto(compressed)
    }
    reader.readAsDataURL(file)
  }

  // ── Submit → open confirmation ───────────────────────────────────────────────
  function handleSubmitClick(e: React.FormEvent) {
    e.preventDefault()
    if (isNaN(current)) { setError('Enter a valid reading'); return }
    if (meter.last_reading !== null && current < meter.last_reading) {
      setError(`Reading (${current}) is less than previous (${meter.last_reading})`)
      return
    }
    setError('')
    setShowConfirm(true)
  }

  // ── Actual submission ────────────────────────────────────────────────────────
  async function confirmSubmit() {
    setLoading(true)
    setError('')
    try {
      await submitReading(meter.id, current, period, photo ?? undefined, notes || undefined,
        gps?.lat, gps?.lng, sealNumber || undefined, tampered || undefined)
      setSuccess(true)
      setShowConfirm(false)
      setTimeout(onSubmitted, 1200)
    } catch (err) {
      const isOffline = !navigator.onLine || String(err).includes('Failed to fetch')
      if (isOffline) {
        await queueReading({
          meterId: meter.id, meterNumber: meter.meter_number, unitLabel: meter.unit_label,
          currentValue: current, billingPeriod: period,
          photoBase64: photo ?? undefined, notes: notes || undefined,
          latitude: gps?.lat, longitude: gps?.lng,
          sealNumber: sealNumber || undefined, tampered: tampered || undefined,
          queuedAt: Date.now(),
        })
        setSuccess(true)
        setShowConfirm(false)
        setTimeout(onSubmitted, 1200)
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
      setTimeout(onSubmitted, 1200)
    } catch (err) {
      const isOffline = !navigator.onLine || String(err).includes('Failed to fetch')
      if (isOffline) {
        await queueReading({
          meterId: meter.id, meterNumber: meter.meter_number, unitLabel: meter.unit_label,
          currentValue: value, billingPeriod: period, notes: inaccessibleNote,
          latitude: gps?.lat, longitude: gps?.lng, queuedAt: Date.now(),
        })
        setSuccess(true)
        setTimeout(onSubmitted, 1200)
      } else {
        setError(err instanceof Error ? err.message : 'Failed to submit')
      }
      setLoading(false)
    }
  }

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col min-h-screen bg-gray-50">

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
                {loading ? 'Submitting…' : isAnomaly ? 'Submit Anyway' : 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Header ───────────────────────────────────────────────────────────── */}
      <div className="bg-green-600 text-white px-4 pt-12 pb-5">
        <button onClick={onBack} className="flex items-center gap-1 text-green-200 text-sm mb-2 active:text-white">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Back to list
        </button>
        <h1 className="text-2xl font-bold">{meter.unit_label}</h1>
        <p className="text-green-200 text-sm mt-0.5">
          #{meter.meter_number} · {formatPeriod(period)}
          {gps && <span className="ml-2 text-green-300">· GPS ✓</span>}
        </p>
      </div>

      <div className="flex-1 px-4 py-5 space-y-4 pb-10">

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
            <input
              type="number"
              inputMode="decimal"
              step="0.001"
              value={currentValue}
              onChange={e => { setCurrentValue(e.target.value); setError('') }}
              className="w-full border-2 border-gray-200 rounded-xl px-4 py-4 text-3xl font-bold text-center text-gray-900 focus:outline-none focus:border-green-500 transition-colors"
              placeholder="0.000"
              required
              autoFocus
            />
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
              <div className="relative">
                <img src={photo} alt="Meter" className="w-full h-40 object-cover rounded-xl" />
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

          {/* Notes — always available, collapsible */}
          {showNotes ? (
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">Note</label>
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
