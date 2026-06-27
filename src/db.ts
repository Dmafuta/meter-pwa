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
  queuedAt: number
}

const db = openDB(DB_NAME, 1, {
  upgrade(d) {
    d.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true })
  }
})

export async function queueReading(r: Omit<PendingReading, 'id'>): Promise<void> {
  await (await db).add(STORE, r)
}

export async function listPending(): Promise<PendingReading[]> {
  return (await db).getAll(STORE)
}

export async function removePending(id: number): Promise<void> {
  return (await db).delete(STORE, id)
}

export async function countPending(): Promise<number> {
  return (await db).count(STORE)
}
