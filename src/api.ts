const BASE = (import.meta.env.VITE_API_URL ?? '') + '/api'

function token() {
  return localStorage.getItem('meter_token') ?? ''
}

// ── Silent token refresh with queue (prevents concurrent refresh races) ───────

let refreshPromise: Promise<boolean> | null = null

async function doRefresh(): Promise<boolean> {
  const refreshToken = localStorage.getItem('meter_refresh_token')
  if (!refreshToken) return false
  try {
    const res = await fetch(BASE + '/auth/refresh-pwa', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    })
    if (!res.ok) return false
    const json = await res.json()
    const { token: newToken, refreshToken: newRefresh } = json.data as { token: string; refreshToken: string }
    localStorage.setItem('meter_token', newToken)
    localStorage.setItem('meter_refresh_token', newRefresh)
    return true
  } catch {
    return false
  }
}

/** If a refresh is already in flight, all callers await the same promise. */
function attemptRefresh(): Promise<boolean> {
  if (!refreshPromise) {
    refreshPromise = doRefresh().finally(() => { refreshPromise = null })
  }
  return refreshPromise
}

function handleAuthExpired() {
  localStorage.removeItem('meter_token')
  localStorage.removeItem('meter_refresh_token')
  localStorage.removeItem('meter_user')
  window.dispatchEvent(new Event('meter:auth-expired'))
}

// ── Fetch wrapper ─────────────────────────────────────────────────────────────

async function apiFetch<T>(path: string, opts: RequestInit = {}): Promise<T> {
  function buildHeaders() {
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token()}`,
      ...(opts.headers as Record<string, string>),
    }
  }

  let res = await fetch(BASE + path, { ...opts, headers: buildHeaders() })

  // ── 401 → attempt silent refresh, then retry once ─────────────────────────
  if (res.status === 401) {
    const refreshed = await attemptRefresh()
    if (refreshed) {
      res = await fetch(BASE + path, { ...opts, headers: buildHeaders() })
      // Still 401 after a successful refresh → account suspended / revoked
      if (res.status === 401) {
        handleAuthExpired()
        const err = new Error('Session expired') as Error & { status: number }
        err.status = 401
        throw err
      }
    } else {
      // Refresh token expired or missing → send to login
      handleAuthExpired()
      const err = new Error('Session expired') as Error & { status: number }
      err.status = 401
      throw err
    }
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
): Promise<{ token: string; refreshToken?: string; user: AuthUser }> {
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
  anomaly: boolean
  tampered: boolean
  utility_type: string
  units_consumed: number
}

export function getReadMeters(period: string): Promise<ReadMeter[]> {
  return apiFetch(`/meter-readings?period=${encodeURIComponent(period)}`)
}

export function getAnomalyReadings(period: string): Promise<ReadMeter[]> {
  return apiFetch(`/meter-readings?period=${encodeURIComponent(period)}&anomaly=true`)
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
