import { useState, useRef, useEffect } from 'react'
import { submitReading, type UnreadMeter } from '../api'
import { queueReading } from '../db'

function formatPeriod(p: string): string {
  const [year, month] = p.split('-')
  return new Date(parseInt(year), parseInt(month) - 1, 1)
    .toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
}

export default function ReadingEntry({
  meter,
  period,
  onSubmitted,
  onBack
}: {
  meter: UnreadMeter
  period: string
  onSubmitted: () => void
  onBack: () => void
}) {
  const [currentValue, setCurrentValue] = useState('')
  const [photo, setPhoto] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)
  const [gps, setGps] = useState<{ lat: number; lng: number } | null>(null)
  const [showInaccessible, setShowInaccessible] = useState(false)
  const photoInputRef = useRef<HTMLInputElement>(null)

  // Silently capture GPS on mount
  useEffect(() => {
    if (!navigator.geolocation) return
    navigator.geolocation.getCurrentPosition(
      pos => setGps({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => { /* GPS unavailable — not required */ },
      { timeout: 8000, maximumAge: 60000 }
    )
  }, [])

  const current = currentValue !== '' ? parseFloat(currentValue) : NaN
  const prev = meter.last_reading ?? 0
  const consumption = !isNaN(current) ? Math.max(0, current - prev) : null

  function handlePhotoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => setPhoto(reader.result as string)
    reader.readAsDataURL(file)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (isNaN(current)) { setError('Enter a valid reading'); return }
    if (meter.last_reading !== null && current < meter.last_reading) {
      setError(`Reading (${current}) is less than previous reading (${meter.last_reading})`)
      return
    }

    setLoading(true)
    setError('')
    try {
      await submitReading(meter.id, current, period, photo ?? undefined, undefined, gps?.lat, gps?.lng)
      setSuccess(true)
      setTimeout(onSubmitted, 1200)
    } catch (err) {
      const isOffline = !navigator.onLine || String(err).includes('Failed to fetch')
      if (isOffline) {
        await queueReading({
          meterId: meter.id,
          meterNumber: meter.meter_number,
          unitLabel: meter.unit_label,
          currentValue: current,
          billingPeriod: period,
          photoBase64: photo ?? undefined,
          latitude: gps?.lat,
          longitude: gps?.lng,
          queuedAt: Date.now()
        })
        setSuccess(true)
        setTimeout(onSubmitted, 1200)
      } else {
        setError(err instanceof Error ? err.message : 'Failed to submit reading')
        setLoading(false)
      }
    }
  }

  async function handleInaccessible() {
    setShowInaccessible(false)
    setLoading(true)
    setError('')
    const value = meter.last_reading ?? 0
    try {
      await submitReading(meter.id, value, period, undefined, 'Meter inaccessible', gps?.lat, gps?.lng)
      setSuccess(true)
      setTimeout(onSubmitted, 1200)
    } catch (err) {
      const isOffline = !navigator.onLine || String(err).includes('Failed to fetch')
      if (isOffline) {
        await queueReading({
          meterId: meter.id,
          meterNumber: meter.meter_number,
          unitLabel: meter.unit_label,
          currentValue: value,
          billingPeriod: period,
          notes: 'Meter inaccessible',
          latitude: gps?.lat,
          longitude: gps?.lng,
          queuedAt: Date.now()
        })
        setSuccess(true)
        setTimeout(onSubmitted, 1200)
      } else {
        setError(err instanceof Error ? err.message : 'Failed to submit')
        setLoading(false)
      }
    }
  }

  return (
    <div className="flex flex-col min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-green-600 text-white px-4 pt-12 pb-5">
        <button onClick={onBack} className="flex items-center gap-1 text-green-200 text-sm mb-2 active:text-white">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Back to list
        </button>
        <h1 className="text-2xl font-bold">{meter.unit_label}</h1>
        <p className="text-green-200 text-sm mt-0.5">#{meter.meter_number} · {formatPeriod(period)}</p>
      </div>

      <div className="flex-1 px-4 py-5 space-y-4">
        {/* Previous reading — prominent */}
        <div className="bg-white rounded-2xl shadow-sm px-4 py-4">
          <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-1">Previous Reading</p>
          <p className="text-4xl font-bold text-gray-900">
            {meter.last_reading !== null ? meter.last_reading.toLocaleString() : '—'}
          </p>
          <p className="text-sm text-gray-400 mt-1">
            {meter.last_reading_date ? `Read on ${meter.last_reading_date}` : 'Never read'}
            {' · '}<span className="capitalize">{meter.utility_type.replace('_', ' ')}</span>
            {gps && <span className="ml-1 text-green-500">· GPS ✓</span>}
          </p>
          {consumption !== null && (
            <div className="mt-3 pt-3 border-t border-gray-50 flex justify-between items-center">
              <span className="text-sm text-gray-500">Consumption</span>
              <span className={`text-sm font-semibold ${consumption > 0 ? 'text-green-700' : 'text-gray-400'}`}>
                {consumption.toFixed(3)} units
              </span>
            </div>
          )}
        </div>

        {/* Reading input */}
        <form onSubmit={handleSubmit} className="bg-white rounded-2xl shadow-sm p-5 space-y-4">
          {error && (
            <div className="bg-red-50 border border-red-100 text-red-700 text-sm rounded-xl p-3">
              {error}
            </div>
          )}

          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              Current Reading
            </label>
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

          {/* Photo capture */}
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
              onChange={handlePhotoChange}
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
                className="w-full border-2 border-dashed border-gray-200 rounded-xl py-5 flex flex-col items-center gap-1 text-gray-400 active:border-green-400 active:text-green-600 transition-colors"
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

          {!navigator.onLine && (
            <p className="text-center text-xs text-orange-600 font-medium">
              Offline — reading will be saved and synced when connected
            </p>
          )}

          {success && (
            <div className="flex items-center justify-center gap-2 bg-green-50 border border-green-200 text-green-700 rounded-xl py-3 font-semibold text-sm">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              Reading saved!
            </div>
          )}

          <button
            type="submit"
            disabled={loading || success || currentValue === ''}
            className="w-full bg-green-600 text-white rounded-xl py-4 font-semibold text-lg disabled:opacity-50 active:bg-green-700 transition-colors"
          >
            {loading ? 'Submitting…' : 'Submit Reading'}
          </button>
        </form>

        {/* Inaccessible */}
        {!success && (
          showInaccessible ? (
            <div className="bg-orange-50 border border-orange-200 rounded-2xl p-4 space-y-3">
              <p className="text-sm font-semibold text-orange-800">Mark as inaccessible?</p>
              <p className="text-xs text-orange-700">
                This will record the previous reading ({meter.last_reading ?? 0}) with a note that the meter could not be accessed.
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
