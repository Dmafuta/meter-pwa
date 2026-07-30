import { useState, useRef, useEffect } from 'react'
import { Mail, Lock, Eye, EyeOff, ArrowRight, ShieldCheck } from 'lucide-react'
import { loginForToken } from '../api'

function LogoMark({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <rect width="100" height="100" rx="22" fill="rgba(255,255,255,0.15)"/>
      <path d="M 30 80 A 28 28 0 1 1 70 80" fill="none" stroke="rgba(255,255,255,0.35)" strokeWidth="5.5" strokeLinecap="round"/>
      <path d="M 30 80 A 28 28 0 1 1 73 42" fill="none" stroke="white" strokeWidth="5.5" strokeLinecap="round"/>
      <line x1="24" y1="47" x2="30" y2="50" stroke="rgba(255,255,255,0.55)" strokeWidth="2" strokeLinecap="round"/>
      <line x1="50" y1="30" x2="50" y2="36" stroke="rgba(255,255,255,0.55)" strokeWidth="2" strokeLinecap="round"/>
      <line x1="76" y1="47" x2="70" y2="50" stroke="rgba(255,255,255,0.55)" strokeWidth="2" strokeLinecap="round"/>
      <line x1="50" y1="58" x2="68" y2="45" stroke="white" strokeWidth="3.5" strokeLinecap="round"/>
      <circle cx="50" cy="58" r="5" fill="white"/>
      <circle cx="50" cy="58" r="2.5" fill="rgba(255,255,255,0.5)"/>
    </svg>
  )
}

export default function Login({ onLogin }: { onLogin: () => void }) {
  const [email, setEmail]             = useState(() => localStorage.getItem('meter_remembered_email') ?? '')
  const [password, setPassword]       = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading]         = useState(false)
  const [error, setError]             = useState('')

  const emailRef    = useRef<HTMLInputElement>(null)
  const passwordRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const t = setTimeout(() => emailRef.current?.focus(), 200)
    return () => clearTimeout(t)
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      const { token, refreshToken, user } = await loginForToken(email.trim(), password)
      localStorage.setItem('meter_token', token)
      if (refreshToken) localStorage.setItem('meter_refresh_token', refreshToken)
      const normalizedUser = { ...user, role: user.role.toLowerCase().replace(/\s+/g, '_') }
      localStorage.setItem('meter_user', JSON.stringify(normalizedUser))
      localStorage.setItem('meter_remembered_email', email.trim())
      onLogin()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="relative flex h-dvh w-full flex-col overflow-hidden lg:flex-row">

      {/* ── Left panel — brand / hero (desktop only) ────────────────────────── */}
      <div
        className="relative hidden w-full overflow-hidden lg:flex lg:w-1/2 lg:h-full lg:flex-col lg:justify-between lg:px-12 lg:py-10 xl:px-16"
        style={{ background: 'var(--gradient-brand)' }}
      >
        <div className="pointer-events-none absolute inset-0 bg-grid opacity-20" aria-hidden />
        <div
          className="pointer-events-none absolute -bottom-20 -left-20 h-[500px] w-[500px] rounded-full blur-3xl opacity-30"
          style={{ background: 'oklch(0.9 0.08 160 / 0.6)' }}
          aria-hidden
        />

        <div className="relative">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-xl bg-white/15 text-white ring-1 ring-white/20">
              <LogoMark size={20} />
            </div>
            <div className="leading-tight">
              <p className="text-[15px] font-semibold text-white">Meter Reader</p>
              <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-white/70">
                Great Wall Gardens
              </p>
            </div>
          </div>
        </div>

        <div className="relative max-w-md">
          <h2 className="text-[32px] font-semibold leading-[1.1] tracking-tight text-white xl:text-[38px]">
            Field-ready meter reading.
          </h2>
          <p className="mt-4 max-w-sm text-[14.5px] leading-relaxed text-white/80">
            Capture readings, flag leaks, and sync with the office — all from your pocket.
          </p>
          <div className="mt-8 flex items-center gap-6 text-[11px] uppercase tracking-[0.16em] text-white/60">
            {['Encrypted', 'Offline capable', 'Crew sync'].map(label => (
              <span key={label} className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-white/80" />
                {label}
              </span>
            ))}
          </div>
        </div>

        <div className="relative">
          <p className="font-mono text-[10.5px] uppercase tracking-[0.2em] text-white/50">
            Maintenance · Plumbing · Utilities
          </p>
        </div>
      </div>

      {/* ── Right panel — form ───────────────────────────────────────────────── */}
      <div
        className="relative flex h-full w-full flex-col overflow-hidden lg:w-1/2"
        style={{ background: 'var(--gradient-surface), var(--color-surface)' }}
      >
        <div className="pointer-events-none absolute inset-0 bg-grid opacity-70" aria-hidden />
        <div
          className="pointer-events-none absolute -top-40 -right-32 h-[420px] w-[420px] rounded-full blur-3xl opacity-40"
          style={{ background: 'var(--gradient-brand)' }}
          aria-hidden
        />

        <div className="relative mx-auto flex h-full w-full max-w-md flex-col px-5 py-6 sm:px-8 sm:py-10 md:max-w-lg lg:max-w-sm lg:px-8 lg:py-10 xl:max-w-md xl:px-12">

          {/* Mobile / tablet brand header */}
          <header className="flex items-center justify-between lg:hidden">
            <div className="flex items-center gap-2.5">
              <div
                className="grid h-9 w-9 shrink-0 place-items-center rounded-xl text-white"
                style={{ background: 'var(--gradient-brand)', boxShadow: 'var(--shadow-brand)' }}
              >
                <LogoMark size={20} />
              </div>
              <div className="min-w-0 leading-tight">
                <p className="text-[15px] font-semibold text-ink">Meter Reader</p>
                <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-muted">
                  Great Wall Gardens
                </p>
              </div>
            </div>
          </header>

          {/* Vertically centred on mobile, top-aligned on desktop */}
          <div className="flex flex-1 flex-col justify-center py-8 sm:py-10 lg:justify-start lg:py-0">

            {/* Hero copy */}
            <section className="lg:mt-0">
              <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-primary">
                — Crew access
              </p>
              <h1 className="mt-3 text-[26px] font-semibold leading-[1.1] text-ink sm:text-[30px] lg:text-[28px] xl:text-[32px]">
                Log in to start
                <br />
                <span className="text-primary">today's route.</span>
              </h1>
              <p className="mt-3 max-w-sm text-[14px] leading-relaxed text-ink-muted lg:text-[13.5px] xl:text-[14.5px]">
                Capture readings, flag leaks, and sync with the office — all from your pocket.
              </p>
            </section>

            {/* Form */}
            <section className="mt-8 sm:mt-10">
              <form onSubmit={handleSubmit} className="space-y-6 lg:space-y-5 xl:space-y-6">

                {error && (
                  <div className="rounded-lg bg-red-50 border border-red-100 px-4 py-3 text-[13.5px] text-red-700">
                    {error}
                  </div>
                )}

                <Field
                  id="email"
                  label="Email"
                  icon={<Mail className="h-[18px] w-[18px]" />}
                  type="email"
                  inputMode="email"
                  enterKeyHint="next"
                  placeholder="you@greatwallgardens.co"
                  autoComplete="email"
                  autoCorrect="off"
                  autoCapitalize="none"
                  value={email}
                  onChange={setEmail}
                  inputRef={emailRef}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); passwordRef.current?.focus() } }}
                />

                <Field
                  id="password"
                  label="Password"
                  icon={<Lock className="h-[18px] w-[18px]" />}
                  type={showPassword ? 'text' : 'password'}
                  enterKeyHint="go"
                  placeholder="Enter your password"
                  autoComplete="current-password"
                  value={password}
                  onChange={setPassword}
                  inputRef={passwordRef}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); (e.target as HTMLInputElement).form?.requestSubmit() } }}
                  trailing={
                    <button
                      type="button"
                      onClick={() => setShowPassword(v => !v)}
                      className="grid h-9 w-9 place-items-center rounded-lg text-ink-muted transition hover:bg-muted hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-primary active:bg-muted"
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                    >
                      {showPassword
                        ? <EyeOff className="h-[18px] w-[18px]" />
                        : <Eye className="h-[18px] w-[18px]" />}
                    </button>
                  }
                />

                <button
                  type="submit"
                  disabled={loading}
                  className="group relative inline-flex h-[52px] w-full items-center justify-center gap-2 overflow-hidden rounded-xl px-4 text-[15px] font-semibold text-white transition focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 active:scale-[0.99] disabled:opacity-60 sm:h-[54px] lg:h-[50px] xl:h-[54px]"
                  style={{ background: 'var(--gradient-brand)', boxShadow: 'var(--shadow-brand)' }}
                >
                  {loading ? (
                    <>
                      <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                      <span>Signing in…</span>
                    </>
                  ) : (
                    <>
                      <span>Sign in</span>
                      <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                    </>
                  )}
                </button>
              </form>

              <div className="mt-5 flex items-center gap-2 text-[11.5px] text-ink-muted">
                <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-primary" />
                Encrypted sign-in. Access restricted to authorized crew only.
              </div>
            </section>
          </div>

          <footer className="mt-auto pt-8 text-center sm:pt-10 lg:pt-8">
            <p className="font-mono text-[10.5px] uppercase tracking-[0.2em] text-ink-muted lg:hidden">
              Maintenance · Plumbing · Utilities
            </p>
            <p className="hidden font-mono text-[10px] uppercase tracking-[0.2em] text-ink-muted lg:block">
              Meter Reader · field edition
            </p>
          </footer>
        </div>
      </div>
    </main>
  )
}

function Field({
  id, label, icon, type, placeholder, autoComplete, autoCorrect,
  autoCapitalize, inputMode, enterKeyHint, value, onChange, onKeyDown,
  inputRef, trailing,
}: {
  id?: string
  label: string
  icon: React.ReactNode
  type: string
  placeholder: string
  autoComplete?: string
  autoCorrect?: string
  autoCapitalize?: string
  inputMode?: React.HTMLAttributes<HTMLInputElement>['inputMode']
  enterKeyHint?: React.HTMLAttributes<HTMLInputElement>['enterKeyHint']
  value: string
  onChange: (v: string) => void
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void
  inputRef?: React.Ref<HTMLInputElement>
  trailing?: React.ReactNode
}) {
  return (
    <div>
      <label
        htmlFor={id}
        className="mb-2 block font-mono text-[10.5px] font-medium uppercase tracking-[0.16em] text-ink-muted"
      >
        {label}
      </label>
      <div className="group relative flex min-h-[52px] items-center gap-2.5 rounded-md border-b border-border bg-transparent px-1 transition focus-within:border-primary has-[input:focus-visible]:shadow-[0_2px_0_0_var(--primary),0_0_0_4px_oklch(0.52_0.13_165_/_0.15)]">
        <span className="shrink-0 text-ink-muted transition group-focus-within:text-primary">{icon}</span>
        <input
          ref={inputRef}
          id={id}
          type={type}
          placeholder={placeholder}
          autoComplete={autoComplete}
          autoCorrect={autoCorrect}
          autoCapitalize={autoCapitalize}
          inputMode={inputMode}
          enterKeyHint={enterKeyHint}
          value={value}
          onChange={e => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          className="w-full bg-transparent py-3 text-[16px] text-ink placeholder:text-ink-muted/70 focus:outline-none sm:text-[15px]"
        />
        {trailing}
      </div>
    </div>
  )
}
