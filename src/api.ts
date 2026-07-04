const BASE = (import.meta.env.VITE_API_URL ?? '') + '/api'

function token() {
  return localStorage.getItem('meter_token') ?? ''
}

async function apiFetch<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const res = await fetch(BASE + path, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token()}`,
      ...(opts.headers as Record<string, string>)
    }
  })
  if (res.status === 401) {
    localStorage.removeItem('meter_token')
    localStorage.removeItem('meter_user')
    window.dispatchEvent(new Event('meter:auth-expired'))
    const err = new Error('Session expired') as Error & { status: number }
    err.status = 401
    throw err
  }
  const json = await res.json()
  if (!res.ok) {
    const err = new Error(json.message ?? 'Request failed') as Error & { status: number }
    err.status = res.status
    throw err
  }
  return json.data as T
}

// ── Auth ──────────────────────────────────────────────────────────────────────

export interface AuthUser {
  id: string
  email: string
  fullName: string
  role: string
}

export async function loginForToken(
  email: string,
  password: string
): Promise<{ token: string; user: AuthUser }> {
  const res = await fetch(BASE + '/auth/login-token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password })
  })
  const json = await res.json()
  if (!res.ok) throw new Error(json.message ?? 'Login failed')
  return json.data
}

// ── Meters ────────────────────────────────────────────────────────────────────

export interface UnreadMeter {
  id: string
  meter_number: string
  unit_id: string
  unit_label: string
  utility_type: string
  meter_type: string
  last_reading: number | null
  last_reading_date: string | null
}

export async function getUnreadMeters(period: string): Promise<UnreadMeter[]> {
  const data = await apiFetch<{ content: UnreadMeter[] }>(
    `/reports/unread-meters?period=${encodeURIComponent(period)}&size=9999`
  )
  return data.content
}

export function submitReading(
  meterId: string,
  currentValue: number,
  billingPeriod: string,
  photoBase64?: string,
  notes?: string,
  latitude?: number,
  longitude?: number,
  sealNumber?: string,
  tampered?: boolean
): Promise<unknown> {
  return apiFetch(`/meters/${meterId}/readings`, {
    method: 'POST',
    body: JSON.stringify({
      current_value: currentValue,
      billing_period: billingPeriod,
      source: 'manual',
      ...(photoBase64  ? { photo_base64: photoBase64 } : {}),
      ...(notes        ? { notes }                      : {}),
      ...(latitude  != null ? { latitude, longitude }   : {}),
      ...(sealNumber   ? { seal_number: sealNumber }    : {}),
      ...(tampered     ? { tampered: true }             : {}),
    })
  })
}

export interface ReadMeter {
  id: string
  meter_id: string
  meter_number: string
  unit_label: string | null
  current_value: number
  billing_period: string
  read_by: string | null
  reading_date: string | null
  notes: string | null
}

export function getReadMeters(period: string): Promise<ReadMeter[]> {
  return apiFetch(`/meter-readings?period=${encodeURIComponent(period)}`)
}

export async function getActivePeriod(): Promise<string | null> {
  try {
    const data = await apiFetch<{ activePeriod: string | null }>('/meter-readings/active-period')
    return data.activePeriod ?? null
  } catch {
    return null
  }
}

// ── Units ──────────────────────────────────────────────────────────────────────

export interface UnitSummary {
  id: string
  unit_label: string
  unit_type: string
  status: string
}

export function listUnits(noMeterForUtility?: string): Promise<UnitSummary[]> {
  const qs = noMeterForUtility ? `?noMeterForUtility=${encodeURIComponent(noMeterForUtility)}` : ''
  return apiFetch(`/units${qs}`)
}

// ── Reading history ────────────────────────────────────────────────────────────

export interface MeterReadingHistory {
  id: string
  billing_period: string | null
  reading_date: string | null
  previous_value: number
  current_value: number
  units_consumed: number
  source: string | null
  status: string
}

export async function getReadingHistory(meterId: string): Promise<MeterReadingHistory[]> {
  return apiFetch(`/meters/${meterId}/readings`)
}

// ── Meter registration ─────────────────────────────────────────────────────────

export interface RegisterMeterPayload {
  meterNumber: string
  unitId?: string
  unitLabel?: string
  utilityType: string
  meterType: string
  meterRole: string
  lastReading?: number
  lastReadingDate?: string
  accountNumber?: string
  notes?: string
}

export function registerMeter(payload: RegisterMeterPayload): Promise<{ id: string; meter_number: string }> {
  return apiFetch('/meters', { method: 'POST', body: JSON.stringify(payload) })
}

// ── Supervisor ────────────────────────────────────────────────────────────────

export interface ReadingProgress {
  period: string
  total_active_meters: number
  total_read: number
  total_unread: number
  completion_pct: number
  anomaly_count: number
  tampered_count: number
  by_reader: { reader_name: string; read_count: number }[]
}

export function getReadingProgress(period: string): Promise<ReadingProgress> {
  return apiFetch(`/reports/reading-progress?period=${encodeURIComponent(period)}`)
}

export interface ReaderPerformance {
  reader_name: string
  readings_count: number
  anomaly_count: number
  tampered_count: number
  inaccessible_count: number
}

export function getReaderPerformance(period: string): Promise<ReaderPerformance[]> {
  return apiFetch(`/reports/reader-performance?period=${encodeURIComponent(period)}`)
}

export interface AssignedMeter {
  id: string
  meter_number: string
  unit_label: string
  utility_type: string
  status: string
  sort_order: number
}

export function getMyAssignments(period: string): Promise<AssignedMeter[]> {
  return apiFetch(`/reading-assignments/mine?period=${encodeURIComponent(period)}`)
}
