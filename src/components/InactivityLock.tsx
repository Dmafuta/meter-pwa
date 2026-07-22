import { useState, useEffect, useCallback, useRef } from 'react'

const IDLE_MS = 5 * 60 * 1000 // 5 minutes

interface Props {
  /** Lock is only active while the user is authenticated (page !== 'login') */
  active: boolean
}

export default function InactivityLock({ active }: Props) {
  const [locked, setLocked] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const resetTimer = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => setLocked(true), IDLE_MS)
  }, [])

  useEffect(() => {
    if (!active) {
      if (timerRef.current) clearTimeout(timerRef.current)
      setLocked(false)
      return
    }

    const events = ['mousemove', 'mousedown', 'touchstart', 'keydown', 'scroll', 'pointerdown']
    events.forEach(e => window.addEventListener(e, resetTimer, { passive: true }))
    resetTimer()

    return () => {
      events.forEach(e => window.removeEventListener(e, resetTimer))
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [active, resetTimer])

  function unlock() {
    setLocked(false)
    resetTimer()
  }

  if (!locked) return null

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-gray-900/95 backdrop-blur-sm"
      onClick={unlock}
    >
      <div className="text-center px-8">
        <div className="w-16 h-16 rounded-full bg-gray-700 flex items-center justify-center mx-auto mb-5">
          <svg className="w-8 h-8 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round"
              d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
          </svg>
        </div>
        <p className="text-white text-xl font-semibold mb-2">Screen locked</p>
        <p className="text-gray-400 text-sm">Tap anywhere to continue</p>
      </div>
    </div>
  )
}
