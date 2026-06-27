import { useState } from 'react'
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
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const current = currentValue !== '' ? parseFloat(currentValue) : NaN
  const prev = meter.last_reading ?? 0
  const consumption = !isNaN(current) ? Math.max(0, current - prev) : null

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
      await submitReading(meter.id, current, period)
      onSubmitted()
    } catch (err) {
      const isOffline = !navigator.onLine || String(err).includes('Failed to fetch')
      if (isOffline) {
        await queueReading({
          meterId: meter.id,
          meterNumber: meter.meter_number,
          unitLabel: meter.unit_label,
          currentValue: current,
          billingPeriod: period,
          queuedAt: Date.now()
        })
        onSubmitted()
      } else {
        setError(err instanceof Error ? err.message : 'Failed to submit reading')
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
        {/* Meter info card */}
        <div className="bg-white rounded-2xl shadow-sm divide-y divide-gray-50">
          <div className="flex justify-between items-center px-4 py-3">
            <span className="text-sm text-gray-500">Utility type</span>
            <span className="text-sm font-medium capitalize text-gray-900">
              {meter.utility_type.replace('_', ' ')}
            </span>
          </div>
          <div className="flex justify-between items-center px-4 py-3">
            <span className="text-sm text-gray-500">Previous reading</span>
            <span className="text-sm font-semibold text-gray-900">
              {meter.last_reading !== null ? meter.last_reading.toLocaleString() : '—'}
            </span>
          </div>
          <div className="flex justify-between items-center px-4 py-3">
            <span className="text-sm text-gray-500">Last read on</span>
            <span className="text-sm font-medium text-gray-900">
              {meter.last_reading_date ?? 'Never'}
            </span>
          </div>
          {consumption !== null && (
            <div className="flex justify-between items-center px-4 py-3">
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

          {!navigator.onLine && (
            <p className="text-center text-xs text-orange-600 font-medium">
              Offline — reading will be saved and synced when connected
            </p>
          )}

          <button
            type="submit"
            disabled={loading || currentValue === ''}
            className="w-full bg-green-600 text-white rounded-xl py-4 font-semibold text-lg disabled:opacity-50 active:bg-green-700 transition-colors"
          >
            {loading ? 'Submitting…' : 'Submit Reading'}
          </button>
        </form>
      </div>
    </div>
  )
}
