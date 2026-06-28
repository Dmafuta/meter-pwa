import { listPending, removePending, markFailed } from './db'
import { submitReading } from './api'

export async function syncPending(): Promise<number> {
  const items = await listPending()
  for (const item of items) {
    try {
      await submitReading(
        item.meterId, item.currentValue, item.billingPeriod,
        item.photoBase64, item.notes, item.latitude, item.longitude
      )
      await removePending(item.id!)
    } catch (err) {
      await markFailed(item.id!, err instanceof Error ? err.message : 'Unknown error')
    }
  }
  return (await listPending()).length
}
