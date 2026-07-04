import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'
import { syncPending } from './sync'

// Sync when connectivity is restored
window.addEventListener('online', () => {
  syncPending().catch(() => {})
})

// Sync when the tab becomes visible again (e.g. user switches back to the app)
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && navigator.onLine) {
    syncPending().catch(() => {})
  }
})

// Periodic sync every 5 minutes while the app is open and online
setInterval(() => {
  if (navigator.onLine) syncPending().catch(() => {})
}, 5 * 60 * 1000)

class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props)
    this.state = { error: null }
  }
  static getDerivedStateFromError(error: Error) {
    return { error }
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 24, fontFamily: 'monospace' }}>
          <h2 style={{ color: '#dc2626' }}>App crashed</h2>
          <pre style={{ whiteSpace: 'pre-wrap', fontSize: 13, color: '#374151' }}>
            {this.state.error.message}
            {'\n\n'}
            {this.state.error.stack}
          </pre>
          <button
            onClick={() => window.location.reload()}
            style={{ marginTop: 16, padding: '8px 16px', background: '#16a34a', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer' }}
          >
            Reload
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
)
