import { useState, useEffect } from 'react'
import Login from './pages/Login'
import PeriodSelect from './pages/PeriodSelect'
import MeterList from './pages/MeterList'
import ReadingEntry from './pages/ReadingEntry'
import PendingQueue from './pages/PendingQueue'
import RegisterMeter from './pages/RegisterMeter'
import OfflineBanner from './components/OfflineBanner'
import InstallPrompt from './components/InstallPrompt'
import type { UnreadMeter } from './api'

type Page = 'login' | 'period' | 'list' | 'entry' | 'queue' | 'register'

export default function App() {
  const [page, setPage] = useState<Page>(() =>
    localStorage.getItem('meter_token') ? 'period' : 'login'
  )
  const [period, setPeriod] = useState('')
  const [selectedMeter, setSelectedMeter] = useState<UnreadMeter | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    const handler = () => setPage('login')
    window.addEventListener('meter:auth-expired', handler)
    return () => window.removeEventListener('meter:auth-expired', handler)
  }, [])

  function logout() {
    localStorage.removeItem('meter_token')
    localStorage.removeItem('meter_user')
    setPage('login')
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <OfflineBanner />
      <InstallPrompt />
      {page === 'login' && (
        <Login onLogin={() => setPage('period')} />
      )}
      {page === 'period' && (
        <PeriodSelect
          onSelect={p => { setPeriod(p); setPage('list') }}
          onLogout={logout}
        />
      )}
      {page === 'list' && (
        <MeterList
          period={period}
          refreshKey={refreshKey}
          onMeterSelect={m => { setSelectedMeter(m); setPage('entry') }}
          onChangePeriod={() => setPage('period')}
          onShowQueue={() => setPage('queue')}
          onRegister={() => setPage('register')}
          onLogout={logout}
        />
      )}
      {page === 'entry' && selectedMeter && (
        <ReadingEntry
          meter={selectedMeter}
          period={period}
          onSubmitted={() => { setRefreshKey(k => k + 1); setPage('list') }}
          onBack={() => setPage('list')}
        />
      )}
      {page === 'queue' && (
        <PendingQueue onBack={() => setPage('list')} />
      )}
      {page === 'register' && (
        <RegisterMeter onBack={() => setPage('list')} />
      )}
    </div>
  )
}
