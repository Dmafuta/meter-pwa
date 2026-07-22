// Background sync relay: when the OS wakes the service worker to flush queued
// readings, forward a message to any open window clients so App.tsx can call
// syncPending() with full access to IndexedDB and the auth token.
self.addEventListener('sync', event => {
  if (event.tag === 'sync-readings') {
    event.waitUntil(
      self.clients
        .matchAll({ type: 'window', includeUncontrolled: true })
        .then(clients => clients.forEach(c => c.postMessage({ type: 'SYNC_READINGS' })))
    )
  }
})
