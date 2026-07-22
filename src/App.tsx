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
import { countPending } from './db'
import { syncPending } from './sync'

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

  // Pending count for badge + document title (poll every 15s)
  const [pendingCount, setPendingCount] = useState(0)
  useEffect(() => {
    const refresh = () => countPending().then(setPendingCount).catch(() => {})
    void refresh()
    const id = setInterval(refresh, 15000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    document.title = pendingCount > 0 ? `(${pendingCount}) Meter Readings` : 'Meter Readings'
    const nav = navigator as Navigator & {
      setAppBadge?(n: number): Promise<void>
      clearAppBadge?(): Promise<void>
    }
    if (pendingCount > 0) nav.setAppBadge?.(pendingCount)?.catch(() => {})
    else                  nav.clearAppBadge?.()?.catch(() => {})
  }, [pendingCount])

  // Auto-sync when tab regains focus (complements OfflineBanner's online-event sync)
  useEffect(() => {
    function handleVisibility() {
      if (!document.hidden && navigator.onLine) {
        void syncPending().then(n => setPendingCount(n))
      }
    }
    document.addEventListener('visibilitychange', handleVisibility)
    return () => document.removeEventListener('visibilitychange', handleVisibility)
  }, [])

  // SW background sync relay: service worker posts SYNC_READINGS when OS wakes it
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return
    const handler = (e: MessageEvent<{ type?: string }>) => {
      if (e.data?.type === 'SYNC_READINGS') void syncPending().then(n => setPendingCount(n))
    }
    navigator.serviceWorker.addEventListener('message', handler)
    return () => navigator.serviceWorker.removeEventListener('message', handler)
  }, [])

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

  async function logout() {
    const pending = await countPending()
    if (pending > 0) {
      const ok = window.confirm(
        `You have ${pending} reading${pending !== 1 ? 's' : ''} queued offline that haven't synced yet. Sign out anyway?`
      )
      if (!ok) return
    }
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
          onGoToDashboard={SUPERVISOR_ROLES.includes(userRole) ? () => setPage('supervisor') : undefined}
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
          onGoToList={() => setPage('list')}
          onLogout={logout}
        />
      )}
    </div>
  )
}
