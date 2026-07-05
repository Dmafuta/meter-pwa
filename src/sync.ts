import { listPending, removePending, markFailed } from './db'
import { submitReading } from './api'

// Readings that fail with a permanent server error (4xx) after MAX_RETRIES
// attempts are abandoned — they stay in the queue visible in PendingQueue but
// won't block other readings from syncing.
export const MAX_RETRIES = 5

export async function syncPending(): Promise<number> {
  const items = await listPending()
  for (const item of items) {
    // Skip permanently failed items — show in queue but don't keep hammering the server
    if ((item.failCount ?? 0) >= MAX_RETRIES) continue

    try {
      await submitReading(
        item.meterId, item.currentValue, item.billingPeriod,
        item.photoBase64, item.notes, item.latitude, item.longitude,
        item.sealNumber, item.tampered
      )
      await removePending(item.id!)
    } catch (err: unknown) {
      const status = (err as { status?: number }).status
      // 4xx = permanent business error — increment fail count
      // 5xx / network = transient — also increment but will retry next cycle
      await markFailed(item.id!, err instanceof Error ? err.message : 'Unknown error')
      // If server explicitly rejected it (4xx), don't retry beyond MAX_RETRIES
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
