import { useState, useEffect } from 'react'
import Login from './pages/Login'
import PeriodSelect from './pages/PeriodSelect'
import MeterList from './pages/MeterList'
import ReadingEntry from './pages/ReadingEntry'
import PendingQueue from './pages/PendingQueue'
import RegisterMeter from './pages/RegisterMeter'
import SupervisorDashboard from './pages/SupervisorDashboard'
import OfflineBanner from './components/OfflineBanner'
import InstallPrompt from './components/InstallPrompt'
import { getActivePeriod } from './api'
import type { UnreadMeter } from './api'

type Page = 'login' | 'period' | 'list' | 'entry' | 'queue' | 'register' | 'supervisor'

function getStoredRole(): string {
  try { return JSON.parse(localStorage.getItem('meter_user') ?? '{}').role ?? '' }
  catch { return '' }
}

const SUPERVISOR_ROLES = ['supervisor', 'meter_supervisor', 'facility_manager', 'admin']

export default function App() {
  const [page, setPage]               = useState<Page>(() =>
    localStorage.getItem('meter_token') ? 'period' : 'login'
  )
  const [userRole, setUserRole]       = useState(getStoredRole)
  const [period, setPeriod]           = useState('')
  const [activePeriod, setActivePeriod] = useState<string | null>(null)
  const [refreshKey, setRefreshKey]   = useState(0)
  const [sessionStart, setSessionStart] = useState(0)

  // Auto-advance state
  const [selectedMeter, setSelectedMeter] = useState<UnreadMeter | null>(null)
  const [meterQueue, setMeterQueue]       = useState<UnreadMeter[]>([])
  const [meterIndex, setMeterIndex]       = useState(0)

  // Fetch active period when reaching period selection
  useEffect(() => {
    if (page === 'period' && localStorage.getItem('meter_token')) {
      getActivePeriod().then(setActivePeriod).catch(() => {})
    }
  }, [page])

  // Auth expiry handler
  useEffect(() => {
    const handler = () => { setActivePeriod(null); setPage('login') }
    window.addEventListener('meter:auth-expired', handler)
    return () => window.removeEventListener('meter:auth-expired', handler)
  }, [])

  function logout() {
    localStorage.removeItem('meter_token')
    localStorage.removeItem('meter_user')
    setUserRole('')
    setPage('login')
  }

  function handlePeriodSelect(p: string) {
    setPeriod(p)
    setSessionStart(Date.now())
    setPage(SUPERVISOR_ROLES.includes(userRole) ? 'supervisor' : 'list')
  }

  function handleMeterSelect(m: UnreadMeter, list: UnreadMeter[], index: number) {
    setSelectedMeter(m)
    setMeterQueue(list)
    setMeterIndex(index)
    setPage('entry')
  }

  function handleReadingSubmitted() {
    const nextIndex = meterIndex + 1
    if (nextIndex < meterQueue.length) {
      // Auto-advance to next meter — key prop on ReadingEntry forces full re-mount
      setSelectedMeter(meterQueue[nextIndex])
      setMeterIndex(nextIndex)
      // Stay on 'entry' page
    } else {
      // Reached end of queue — back to list with refresh
      setRefreshKey(k => k + 1)
      setPage('list')
    }
  }

  const nextMeter = meterQueue[meterIndex + 1] ?? null

  return (
    <div className="min-h-screen bg-gray-50">
      <OfflineBanner />
      <InstallPrompt />

      {page === 'login' && (
        <Login onLogin={() => { setUserRole(getStoredRole()); setPage('period') }} />
      )}

      {page === 'period' && (
        <PeriodSelect
          onSelect={handlePeriodSelect}
          onLogout={logout}
          activePeriod={activePeriod}
        />
      )}

      {page === 'list' && (
        <MeterList
          period={period}
          refreshKey={refreshKey}
          sessionStart={sessionStart}
          onMeterSelect={handleMeterSelect}
          onChangePeriod={() => setPage('period')}
          onShowQueue={() => setPage('queue')}
          onRegister={userRole === 'field_technician' ? () => setPage('register') : undefined}
          onLogout={logout}
        />
      )}

      {page === 'entry' && selectedMeter && (
        <ReadingEntry
          key={selectedMeter.id}
          meter={selectedMeter}
          period={period}
          nextMeter={nextMeter}
          onSubmitted={handleReadingSubmitted}
          onBack={() => setPage('list')}
        />
      )}

      {page === 'queue' && (
        <PendingQueue onBack={() => setPage('list')} />
      )}

      {page === 'register' && (
        <RegisterMeter onBack={() => setPage('list')} />
      )}

      {page === 'supervisor' && (
        <SupervisorDashboard
          period={period}
          onChangePeriod={() => setPage('period')}
          onLogout={logout}
        />
      )}
    </div>
  )
}
