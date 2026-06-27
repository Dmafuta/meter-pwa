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
    throw new Error('Session expired')
  }
  const json = await res.json()
  if (!res.ok) throw new Error(json.message ?? 'Request failed')
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

export function getUnreadMeters(period: string): Promise<UnreadMeter[]> {
  return apiFetch(`/reports/unread-meters?period=${encodeURIComponent(period)}`)
}

export function submitReading(
  meterId: string,
  currentValue: number,
  billingPeriod: string,
  photoBase64?: string
): Promise<unknown> {
  return apiFetch(`/meters/${meterId}/readings`, {
    method: 'POST',
    body: JSON.stringify({
      current_value: currentValue,
      billing_period: billingPeriod,
      source: 'manual',
      ...(photoBase64 ? { photo_base64: photoBase64 } : {})
    })
  })
}
