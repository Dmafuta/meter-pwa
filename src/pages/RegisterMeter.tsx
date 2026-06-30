import { useState, useEffect, useRef } from 'react'
import { listUnits, registerMeter, type UnitSummary } from '../api'

const UTILITY_TYPES = [
  { value: 'water',       label: '💧 Water' },
  { value: 'water_sewer', label: '💧 Water & Sewerage' },
  { value: 'sewerage',    label: '🚰 Sewerage' },
  { value: 'electricity', label: '⚡ Electricity' },
  { value: 'gas_piped',   label: '🔥 Gas (Piped)' },
  { value: 'internet',    label: '📶 Internet' },
]

const METER_ROLES = [
  { value: 'consumer',     label: 'Consumer (Unit)' },
  { value: 'supplier',     label: 'Supplier' },
  { value: 'tank_inflow',  label: 'Tank Inflow' },
  { value: 'tank_outflow', label: 'Tank Outflow' },
  { value: 'distribution', label: 'Distribution' },
]

const INPUT = 'w-full border border-gray-300 rounded-xl px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-green-500 bg-white'
const LABEL = 'block text-sm font-medium text-gray-700 mb-1'

export default function RegisterMeter({ onBack }: { onBack: () => void }) {
  const [meterNumber, setMeterNumber] = useState('')
  const [utilityType, setUtilityType] = useState('water')
  const [meterRole, setMeterRole]     = useState('consumer')
  const [meterType, setMeterType]     = useState('postpaid')
  const [unitSearch, setUnitSearch]   = useState('')
  const [selectedUnit, setSelectedUnit] = useState<UnitSummary | null>(null)
  const [lastReading, setLastReading] = useState('')
  const [lastReadingDate, setLastReadingDate] = useState(new Date().toISOString().slice(0, 10))
  const [accountNumber, setAccountNumber] = useState('')
  const [notes, setNotes]             = useState('')

  const [units, setUnits]             = useState<UnitSummary[]>([])
  const [loadingUnits, setLoadingUnits] = useState(false)
  const [showUnitList, setShowUnitList] = useState(false)
  const [saving, setSaving]           = useState(false)
  const [error, setError]             = useState('')
  const [success, setSuccess]         = useState(false)
  const [savedMeterNumber, setSavedMeterNumber] = useState('')

  // Barcode scan
  const [scanning, setScanning]       = useState(false)
  const [scanError, setScanError]     = useState('')
  const videoRef                      = useRef<HTMLVideoElement>(null)
  const streamRef                     = useRef<MediaStream | null>(null)

  const isConsumer = meterRole === 'consumer'

  useEffect(() => {
    setLoadingUnits(true)
    listUnits()
      .then(setUnits)
      .catch(() => {})
      .finally(() => setLoadingUnits(false))
  }, [])

  const filteredUnits = unitSearch.trim().length >= 1
    ? units.filter(u =>
        u.unit_label.toLowerCase().includes(unitSearch.toLowerCase()) ||
        u.status === 'occupied' || u.status === 'vacant'
      ).slice(0, 10)
    : []

  // ── Barcode scanning ──────────────────────────────────────────────────────

  async function startScan() {
    setScanError('')
    setScanning(true)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' }
      })
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        videoRef.current.play()
      }

      // Use BarcodeDetector if available
      if ('BarcodeDetector' in window) {
        const detector = new (window as unknown as { BarcodeDetector: new (opts: object) => { detect: (img: HTMLVideoElement) => Promise<Array<{ rawValue: string }>> } }).BarcodeDetector({
          formats: ['code_128', 'code_39', 'qr_code', 'data_matrix', 'ean_13', 'ean_8']
        })
        const scan = async () => {
          if (!videoRef.current || !scanning) return
          try {
            const barcodes = await detector.detect(videoRef.current)
            if (barcodes.length > 0) {
              setMeterNumber(barcodes[0].rawValue)
              stopScan()
              return
            }
          } catch { /* continue */ }
          if (streamRef.current) requestAnimationFrame(scan)
        }
        videoRef.current?.addEventListener('playing', () => requestAnimationFrame(scan), { once: true })
      } else {
        setScanError('Barcode scanning not supported on this browser. Enter meter number manually.')
        stopScan()
      }
    } catch {
      setScanError('Camera access denied. Enter meter number manually.')
      setScanning(false)
    }
  }

  function stopScan() {
    streamRef.current?.getTracks().forEach(t => t.stop())
    streamRef.current = null
    setScanning(false)
  }

  useEffect(() => () => stopScan(), [])

  // ── Submit ────────────────────────────────────────────────────────────────

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!meterNumber.trim()) { setError('Meter number is required'); return }
    if (!utilityType) { setError('Utility type is required'); return }
    if (isConsumer && !selectedUnit) { setError('Select a unit for consumer meters'); return }

    setSaving(true); setError('')
    try {
      const result = await registerMeter({
        meterNumber:     meterNumber.trim(),
        utilityType,
        meterType,
        meterRole,
        unitId:          selectedUnit?.id,
        unitLabel:       selectedUnit?.unit_label,
        lastReading:     lastReading !== '' ? Number(lastReading) : undefined,
        lastReadingDate: lastReadingDate || undefined,
        accountNumber:   accountNumber.trim() || undefined,
        notes:           notes.trim() || undefined,
      })
      setSavedMeterNumber(result.meter_number)
      setSuccess(true)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Registration failed')
    } finally {
      setSaving(false)
    }
  }

  function resetForm() {
    setMeterNumber(''); setUnitSearch(''); setSelectedUnit(null)
    setLastReading(''); setLastReadingDate(new Date().toISOString().slice(0, 10))
    setAccountNumber(''); setNotes(''); setError(''); setSuccess(false)
  }

  // ── Success screen ────────────────────────────────────────────────────────

  if (success) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center px-6 text-center">
        <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mb-5">
          <svg className="w-10 h-10 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h2 className="text-xl font-bold text-gray-900">Meter Registered</h2>
        <p className="text-gray-500 mt-2">#{savedMeterNumber} has been added to the system.</p>
        <div className="flex flex-col gap-3 mt-8 w-full max-w-xs">
          <button onClick={resetForm}
            className="w-full py-3 bg-green-600 text-white rounded-xl font-semibold text-base">
            Register Another
          </button>
          <button onClick={onBack}
            className="w-full py-3 bg-white border border-gray-200 text-gray-700 rounded-xl font-semibold text-base">
            Back to Meter List
          </button>
        </div>
      </div>
    )
  }

  // ── Camera scan overlay ───────────────────────────────────────────────────

  if (scanning) {
    return (
      <div className="fixed inset-0 bg-black z-50 flex flex-col">
        <div className="flex items-center justify-between px-4 pt-12 pb-3 safe-top">
          <p className="text-white font-semibold">Point camera at barcode</p>
          <button onClick={stopScan} className="text-white text-sm px-3 py-1 border border-white/40 rounded-lg">
            Cancel
          </button>
        </div>
        <div className="flex-1 relative">
          <video ref={videoRef} className="w-full h-full object-cover" playsInline muted />
          {/* Scan reticle */}
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="w-64 h-36 border-2 border-green-400 rounded-lg relative">
              <div className="absolute top-0 left-0 w-5 h-5 border-t-4 border-l-4 border-green-400 rounded-tl" />
              <div className="absolute top-0 right-0 w-5 h-5 border-t-4 border-r-4 border-green-400 rounded-tr" />
              <div className="absolute bottom-0 left-0 w-5 h-5 border-b-4 border-l-4 border-green-400 rounded-bl" />
              <div className="absolute bottom-0 right-0 w-5 h-5 border-b-4 border-r-4 border-green-400 rounded-br" />
            </div>
          </div>
        </div>
        {scanError && (
          <div className="px-4 pb-8 text-center">
            <p className="text-orange-300 text-sm">{scanError}</p>
          </div>
        )}
      </div>
    )
  }

  // ── Registration form ─────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Header */}
      <div className="bg-green-600 text-white px-4 pt-12 pb-5 safe-top">
        <div className="flex items-center gap-3 mb-1">
          <button onClick={onBack} className="text-green-200 active:text-white">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <h1 className="text-xl font-bold">Register Meter</h1>
        </div>
        <p className="text-green-200 text-sm pl-8">Add a new meter to the system</p>
      </div>

      <form onSubmit={handleSubmit} className="flex-1 px-4 py-5 space-y-5 overflow-y-auto pb-32">

        {/* Meter Number + scan */}
        <div>
          <label className={LABEL}>Meter Number *</label>
          <div className="flex gap-2">
            <input
              value={meterNumber}
              onChange={e => setMeterNumber(e.target.value)}
              placeholder="e.g. WM-001 or scan barcode"
              className={INPUT + ' flex-1'}
              autoCapitalize="characters"
            />
            <button type="button" onClick={startScan}
              className="px-4 py-3 bg-green-100 text-green-700 rounded-xl active:bg-green-200 shrink-0"
              title="Scan barcode">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M4 6h2M4 10h2M4 14h2M4 18h2M8 4v16M18 4v16M12 4v16M20 6h-2M20 10h-2M20 14h-2M20 18h-2" />
              </svg>
            </button>
          </div>
        </div>

        {/* Utility type */}
        <div>
          <label className={LABEL}>Utility Type *</label>
          <select value={utilityType} onChange={e => setUtilityType(e.target.value)} className={INPUT}>
            {UTILITY_TYPES.map(u => <option key={u.value} value={u.value}>{u.label}</option>)}
          </select>
        </div>

        {/* Meter role */}
        <div>
          <label className={LABEL}>Meter Role *</label>
          <select value={meterRole} onChange={e => { setMeterRole(e.target.value); setSelectedUnit(null); setUnitSearch('') }} className={INPUT}>
            {METER_ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
        </div>

        {/* Meter type */}
        <div>
          <label className={LABEL}>Meter Type</label>
          <select value={meterType} onChange={e => setMeterType(e.target.value)} className={INPUT}>
            <option value="postpaid">Postpaid</option>
            <option value="prepaid">Prepaid</option>
            <option value="smart">Smart / IoT</option>
          </select>
        </div>

        {/* Unit assignment (consumer only) */}
        {isConsumer && (
          <div className="relative">
            <label className={LABEL}>Unit *</label>
            {selectedUnit ? (
              <div className="flex items-center gap-3 p-3 bg-green-50 border border-green-200 rounded-xl">
                <div className="flex-1">
                  <p className="font-semibold text-gray-900">{selectedUnit.unit_label}</p>
                  <p className="text-xs text-gray-500 capitalize">{selectedUnit.unit_type} · {selectedUnit.status}</p>
                </div>
                <button type="button" onClick={() => { setSelectedUnit(null); setUnitSearch('') }}
                  className="text-gray-400 active:text-gray-600">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            ) : (
              <>
                <input
                  value={unitSearch}
                  onChange={e => { setUnitSearch(e.target.value); setShowUnitList(true) }}
                  onFocus={() => setShowUnitList(true)}
                  placeholder={loadingUnits ? 'Loading units…' : 'Search unit label (e.g. A101)'}
                  className={INPUT}
                />
                {showUnitList && filteredUnits.length > 0 && (
                  <div className="absolute left-0 right-0 top-full mt-1 bg-white border border-gray-200 rounded-xl shadow-lg z-10 max-h-48 overflow-y-auto">
                    {filteredUnits.map(u => (
                      <button
                        key={u.id}
                        type="button"
                        className="w-full text-left px-4 py-3 border-b border-gray-100 last:border-0 active:bg-gray-50"
                        onClick={() => { setSelectedUnit(u); setUnitSearch(u.unit_label); setShowUnitList(false) }}
                      >
                        <p className="font-semibold text-gray-900">{u.unit_label}</p>
                        <p className="text-xs text-gray-400 capitalize">{u.unit_type} · {u.status}</p>
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* Opening reading */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={LABEL}>Opening Reading</label>
            <input
              type="number"
              value={lastReading}
              onChange={e => setLastReading(e.target.value)}
              placeholder="0.000"
              min="0"
              step="0.001"
              className={INPUT}
            />
          </div>
          <div>
            <label className={LABEL}>Reading Date</label>
            <input
              type="date"
              value={lastReadingDate}
              onChange={e => setLastReadingDate(e.target.value)}
              className={INPUT}
            />
          </div>
        </div>

        {/* Account number */}
        <div>
          <label className={LABEL}>Account Number</label>
          <input
            value={accountNumber}
            onChange={e => setAccountNumber(e.target.value)}
            placeholder="Optional"
            className={INPUT}
          />
        </div>

        {/* Notes */}
        <div>
          <label className={LABEL}>Notes</label>
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder="Optional notes about installation location, condition, etc."
            rows={3}
            className={INPUT + ' resize-none'}
          />
        </div>

        {scanError && !scanning && (
          <p className="text-orange-600 text-sm bg-orange-50 rounded-xl px-4 py-3">{scanError}</p>
        )}
        {error && (
          <p className="text-red-600 text-sm bg-red-50 rounded-xl px-4 py-3">{error}</p>
        )}
      </form>

      {/* Fixed bottom submit */}
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 px-4 py-4 safe-bottom">
        <button
          type="submit"
          onClick={handleSubmit}
          disabled={saving}
          className="w-full py-4 bg-green-600 text-white rounded-xl font-semibold text-base disabled:opacity-50 active:bg-green-700"
        >
          {saving ? 'Registering…' : 'Register Meter'}
        </button>
      </div>
    </div>
  )
}
