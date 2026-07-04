import { openDB } from 'idb'

const DB_NAME = 'meter-pwa'
const STORE = 'pending'

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

function openDb() {
  try {
    return openDB(DB_NAME, 3, {
      upgrade(d, oldVersion) {
        if (oldVersion < 1) {
          d.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true })
        }
        // v2: adds failCount, lastError, photoBase64 — no schema change needed
        // v3: adds notes, latitude, longitude — no schema change needed
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
