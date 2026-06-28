import { useState, useEffect } from 'react'

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

export default function InstallPrompt() {
  const [prompt, setPrompt] = useState<BeforeInstallPromptEvent | null>(null)
  const [dismissed, setDismissed] = useState(
    () => localStorage.getItem('pwa-install-dismissed') === '1'
  )

  useEffect(() => {
    const handler = (e: Event) => {
      e.preventDefault()
      setPrompt(e as BeforeInstallPromptEvent)
    }
    window.addEventListener('beforeinstallprompt', handler)
    return () => window.removeEventListener('beforeinstallprompt', handler)
  }, [])

  if (!prompt || dismissed) return null

  async function install() {
    await prompt!.prompt()
    const { outcome } = await prompt!.userChoice
    if (outcome === 'dismissed') {
      localStorage.setItem('pwa-install-dismissed', '1')
      setDismissed(true)
    }
    setPrompt(null)
  }

  function dismiss() {
    localStorage.setItem('pwa-install-dismissed', '1')
    setDismissed(true)
  }

  return (
    <div className="fixed bottom-4 left-4 right-4 z-50 bg-white rounded-2xl shadow-xl border border-gray-100 p-4 flex items-center gap-3">
      <div className="w-10 h-10 bg-green-600 rounded-xl flex items-center justify-center shrink-0">
        <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M12 10v6m0 0l-3-3m3 3l3-3M3 17V7a2 2 0 012-2h6l2 2h6a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
        </svg>
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-semibold text-gray-900 text-sm">Add to home screen</p>
        <p className="text-xs text-gray-500">Works offline once installed</p>
      </div>
      <div className="flex gap-2 shrink-0">
        <button onClick={dismiss} className="text-xs text-gray-400 px-2 py-1">
          Later
        </button>
        <button
          onClick={install}
          className="text-xs bg-green-600 text-white px-3 py-1.5 rounded-lg font-semibold active:bg-green-700"
        >
          Install
        </button>
      </div>
    </div>
  )
}
