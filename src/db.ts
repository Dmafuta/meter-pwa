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
  queuedAt: number
  failCount: number
  lastError?: string
}

const db = openDB(DB_NAME, 2, {
  upgrade(d, oldVersion) {
    if (oldVersion < 1) {
      d.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true })
    }
    // v2: adds failCount, lastError, photoBase64 fields — no schema change needed
  }
})

export async function queueReading(r: Omit<PendingReading, 'id' | 'failCount'>): Promise<void> {
  await (await db).add(STORE, { ...r, failCount: 0 })
}

export async function listPending(): Promise<PendingReading[]> {
  return (await db).getAll(STORE)
}

export async function removePending(id: number): Promise<void> {
  return (await db).delete(STORE, id)
}

export async function markFailed(id: number, error: string): Promise<void> {
  const store = await db
  const item = await store.get(STORE, id) as PendingReading
  if (item) {
    await store.put(STORE, { ...item, failCount: (item.failCount ?? 0) + 1, lastError: error })
  }
}

export async function countPending(): Promise<number> {
  return (await db).count(STORE)
}
