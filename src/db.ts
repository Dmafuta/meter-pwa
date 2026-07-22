import { openDB } from 'idb'

const DB_NAME       = 'meter-pwa'
const STORE         = 'pending'
const CACHE_STORE   = 'meter-cache'
const CONFLICTS_STORE = 'conflicts'
const HISTORY_STORE   = 'history-cache'

export interface PendingReading {
  id?: number
  meterId: string
  meterNumber: string
  unitLabel: string
  currentValue: number
  billingPeriod: string
  photoBase64?: string
  notes?: string
  latitude?: number
  longitude?: number
  sealNumber?: string
  tampered?: boolean
  queuedAt: number
  failCount: number
  lastError?: string
}

export interface ConflictReading {
  id?: number
  meterId: string
  meterNumber: string
  unitLabel: string
  currentValue: number
  billingPeriod: string
  conflictedAt: number
  reason: string
}

function openDb() {
  try {
    return openDB(DB_NAME, 5, {
      upgrade(d, oldVersion) {
        if (oldVersion < 1) {
          d.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true })
        }
        // v2: adds failCount, lastError, photoBase64 — no schema change needed
        // v3: adds notes, latitude, longitude — no schema change needed
        if (oldVersion < 4) {
          if (!d.objectStoreNames.contains(CACHE_STORE))
            d.createObjectStore(CACHE_STORE) // keyed by period string
        }
        if (oldVersion < 5) {
          if (!d.objectStoreNames.contains(CONFLICTS_STORE))
            d.createObjectStore(CONFLICTS_STORE, { keyPath: 'id', autoIncrement: true })
          if (!d.objectStoreNames.contains(HISTORY_STORE))
            d.createObjectStore(HISTORY_STORE) // keyed by meterId string
        }
      }
    }).catch(err => {
      console.warn('[meter-pwa] IndexedDB unavailable — offline queue disabled:', err)
      return null as never
    })
  } catch (err) {
    console.warn('[meter-pwa] IndexedDB not supported — offline queue disabled:', err)
    return Promise.resolve(null as never)
  }
}

const db = openDb()

export async function queueReading(r: Omit<PendingReading, 'id' | 'failCount'>): Promise<void> {
  const store = await db
  if (!store) return
  await store.add(STORE, { ...r, failCount: 0 })
  // Register a background sync tag so the OS can wake the service worker
  // when connectivity is restored, even if the app is not open.
  navigator.serviceWorker?.ready
    .then(reg => (reg as unknown as { sync?: { register(tag: string): Promise<void> } }).sync?.register('sync-readings'))
    .catch(() => {})
}

export async function listPending(): Promise<PendingReading[]> {
  const store = await db
  if (!store) return []
  return store.getAll(STORE)
}

export async function removePending(id: number): Promise<void> {
  const store = await db
  if (!store) return
  return store.delete(STORE, id)
}

export async function markFailed(id: number, error: string): Promise<void> {
  const store = await db
  if (!store) return
  const item = await store.get(STORE, id) as PendingReading
  if (item) {
    await store.put(STORE, { ...item, failCount: (item.failCount ?? 0) + 1, lastError: error })
  }
}

export async function countPending(): Promise<number> {
  const store = await db
  if (!store) return 0
  return store.count(STORE)
}

export async function resetFailed(id: number): Promise<void> {
  const store = await db
  if (!store) return
  const item = await store.get(STORE, id) as PendingReading
  if (item) {
    await store.put(STORE, { ...item, failCount: 0, lastError: undefined })
  }
}

// ── Conflict readings (409 from server — already read by another user) ─────────

export async function saveConflict(r: Omit<ConflictReading, 'id'>): Promise<void> {
  const store = await db
  if (!store) return
  await store.add(CONFLICTS_STORE, r)
}

export async function listConflicts(): Promise<ConflictReading[]> {
  const store = await db
  if (!store) return []
  return store.getAll(CONFLICTS_STORE)
}

export async function removeConflict(id: number): Promise<void> {
  const store = await db
  if (!store) return
  return store.delete(CONFLICTS_STORE, id)
}

// ── Reading history cache (persist per-meter history to IndexedDB) ─────────────

export async function saveHistoryCache(meterId: string, history: unknown[]): Promise<void> {
  const store = await db
  if (!store) return
  await store.put(HISTORY_STORE, { history, timestamp: Date.now() }, meterId)
}

export async function loadHistoryCache(meterId: string): Promise<unknown[] | null> {
  const store = await db
  if (!store) return null
  const cached = await store.get(HISTORY_STORE, meterId) as { history: unknown[]; timestamp: number } | undefined
  // Expire cache entries older than 24h
  if (!cached || Date.now() - cached.timestamp > 24 * 3600 * 1000) return null
  return cached.history
}

// ── Meter list cache (offline support) ────────────────────────────────────────

export async function saveMeterCache(period: string, meters: unknown[]): Promise<void> {
  const store = await db
  if (!store) return
  await store.put(CACHE_STORE, { meters, timestamp: Date.now() }, period)
}

export async function loadMeterCache(period: string): Promise<{ meters: unknown[]; timestamp: number } | null> {
  const store = await db
  if (!store) return null
  return (store.get(CACHE_STORE, period) as Promise<{ meters: unknown[]; timestamp: number } | undefined>)
    .then(v => v ?? null)
}

export async function resetAllFailed(): Promise<void> {
  const store = await db
  if (!store) return
  const all = await store.getAll(STORE) as PendingReading[]
  await Promise.all(
    all
      .filter(item => (item.failCount ?? 0) > 0)
      .map(item => store.put(STORE, { ...item, failCount: 0, lastError: undefined }))
  )
}
