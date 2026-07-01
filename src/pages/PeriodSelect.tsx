import { useState } from 'react'

function currentPeriod(): string {
  const now = new Date()
  // Default to previous month — readings taken at start of month bill the prior month's consumption
  const d = new Date(now.getFullYear(), now.getMonth() - 1, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function formatPeriod(p: string): string {
  const [year, month] = p.split('-')
  return new Date(parseInt(year), parseInt(month) - 1, 1)
    .toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
}

function adjustPeriod(p: string, delta: number): string {
  const [year, month] = p.split('-').map(Number)
  const d = new Date(year, month - 1 + delta, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export default function PeriodSelect({
  onSelect,
  onLogout
}: {
  onSelect: (p: string) => void
  onLogout: () => void
}) {
  const [period, setPeriod] = useState(currentPeriod)
  const user: { fullName?: string } = JSON.parse(localStorage.getItem('meter_user') ?? '{}')

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gray-50 p-4">
      <div className="w-full max-w-sm">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-xl font-bold text-gray-900">Select Period</h1>
            {user.fullName && <p className="text-sm text-gray-500">{user.fullName}</p>}
          </div>
          <button onClick={onLogout} className="text-sm text-gray-400 hover:text-gray-600 py-1 px-2">
            Sign out
          </button>
        </div>

        <div className="bg-white rounded-2xl shadow-sm p-6">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-4">Billing Period</p>

          <div className="flex items-center justify-between gap-3 mb-6">
            <button
              onClick={() => setPeriod(p => adjustPeriod(p, -1))}
              className="w-11 h-11 rounded-full border border-gray-200 flex items-center justify-center text-xl text-gray-500 active:bg-gray-100"
            >
              ‹
            </button>
            <span className="text-xl font-semibold text-gray-900 flex-1 text-center">
              {formatPeriod(period)}
            </span>
            <button
              onClick={() => setPeriod(p => adjustPeriod(p, 1))}
              className="w-11 h-11 rounded-full border border-gray-200 flex items-center justify-center text-xl text-gray-500 active:bg-gray-100"
            >
              ›
            </button>
          </div>

          <button
            onClick={() => onSelect(period)}
            className="w-full bg-green-600 text-white rounded-xl py-3.5 font-semibold text-base active:bg-green-700 transition-colors"
          >
            Start Reading
          </button>
        </div>
      </div>
    </div>
  )
}
