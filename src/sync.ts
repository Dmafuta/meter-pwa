import { listPending, removePending, markFailed, saveConflict } from './db'
import { submitReading } from './api'

// Readings that fail with a permanent server error (4xx) after MAX_RETRIES
// attempts are abandoned — they stay in the queue visible in PendingQueue but
// won't block other readings from syncing.
export const MAX_RETRIES = 5

async function syncItem(
  item: Awaited<ReturnType<typeof listPending>>[number]
): Promise<void> {
  await submitReading(
    item.meterId, item.currentValue, item.billingPeriod,
    item.photoBase64, item.notes, item.latitude, item.longitude,
    item.sealNumber, item.tampered
  )
  await removePending(item.id!)
  localStorage.setItem('meter_last_synced', new Date().toISOString())
}

export async function syncPending(): Promise<number> {
  const items = await listPending()
  for (const item of items) {
    if ((item.failCount ?? 0) >= MAX_RETRIES) continue
    try {
      await syncItem(item)
    } catch (err: unknown) {
      const status = (err as { status?: number }).status
      if (status === 409) {
        // Conflict — reading already submitted by another user; save for review
        await saveConflict({
          meterId: item.meterId, meterNumber: item.meterNumber, unitLabel: item.unitLabel,
          currentValue: item.currentValue, billingPeriod: item.billingPeriod,
          conflictedAt: Date.now(), reason: 'Already read by another user',
        })
        await removePending(item.id!)
        continue
      }
      const msg = err instanceof Error ? err.message : 'Unknown error'
      await markFailed(item.id!, msg)
      if (status && status >= 400 && status < 500) {
        const updated = (item.failCount ?? 0) + 1
        if (updated >= MAX_RETRIES) {
          console.warn(`[sync] Reading for ${item.unitLabel} permanently failed after ${MAX_RETRIES} attempts: ${(err as Error).message}`)
        }
      }
    }
  }
  return (await listPending()).length
}

/** Like syncPending but fires callbacks per-item so the UI can show progress. */
export async function syncPendingWithProgress(
  onItemStart: (id: number) => void,
  onItemDone:  (id: number) => void
): Promise<number> {
  const items = await listPending()
  for (const item of items) {
    if ((item.failCount ?? 0) >= MAX_RETRIES) continue
    onItemStart(item.id!)
    try {
      await syncItem(item)
    } catch (err: unknown) {
      const status = (err as { status?: number }).status
      if (status === 409) {
        await saveConflict({
          meterId: item.meterId, meterNumber: item.meterNumber, unitLabel: item.unitLabel,
          currentValue: item.currentValue, billingPeriod: item.billingPeriod,
          conflictedAt: Date.now(), reason: 'Already read by another user',
        })
        await removePending(item.id!)
      } else {
        await markFailed(item.id!, err instanceof Error ? err.message : 'Unknown error')
      }
    }
    onItemDone(item.id!)
  }
  return (await listPending()).length
}
