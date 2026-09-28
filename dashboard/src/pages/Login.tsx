import { useAuth } from '@/store/useAuth'
import { useState, type FormEvent } from 'react'

/**
 * Sign-in screen shown before the dashboard.
 *
 * Deliberately plain: one card, two fields, one error line. The failure
 * message never says which of the two was wrong — that distinction helps
 * nobody legitimate and hands an attacker half the answer.
 */
export function Login() {
  const signIn = useAuth((s) => s.signIn)
  const [user, setUser] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState(false)

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!signIn(user, password)) {
      setError(true)
      setPassword('')
    }
  }

  return (
    <div className="flex min-h-full items-center justify-center bg-plane px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center gap-3">
          <img src="/sebn-logo.png" alt="" className="h-10 w-auto rounded-lg" />
          <div>
            <p className="text-[0.9375rem] leading-tight font-semibold text-ink">
              SEBN <span className="text-ink-muted">TN3</span>
            </p>
            <p className="text-xs text-ink-muted">Rework quality dashboard</p>
          </div>
        </div>

        <form onSubmit={submit} className="card p-6">
          <h1 className="text-base font-semibold text-ink">Sign in</h1>
          <p className="mt-1 text-xs text-ink-muted">
            Enter the credentials provided for this dashboard.
          </p>

          <label className="mt-5 block">
            <span className="text-xs font-medium text-ink-secondary">User</span>
            <input
              type="text"
              value={user}
              onChange={(e) => {
                setUser(e.target.value)
                setError(false)
              }}
              autoFocus
              autoComplete="username"
              className="mt-1.5 w-full rounded-md border border-hairline bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-muted focus:border-s1 focus:outline-none"
              placeholder="kskscrapper"
            />
          </label>

          <label className="mt-4 block">
            <span className="text-xs font-medium text-ink-secondary">Password</span>
            <input
              type="password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value)
                setError(false)
              }}
              autoComplete="current-password"
              className="mt-1.5 w-full rounded-md border border-hairline bg-surface px-3 py-2 text-sm text-ink focus:border-s1 focus:outline-none"
            />
          </label>

          {/* Icon + text, never colour alone. */}
          {error && (
            <p className="mt-4 flex items-center gap-1.5 text-xs font-medium text-critical" role="alert">
              <svg viewBox="0 0 16 16" className="size-3.5 shrink-0" fill="currentColor" aria-hidden>
                <path d="M8 1.5 15 14H1L8 1.5Zm0 4.2a.7.7 0 0 0-.7.75l.2 3.1a.5.5 0 0 0 1 0l.2-3.1A.7.7 0 0 0 8 5.7Zm0 5.3a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Z" />
              </svg>
              Incorrect user or password.
            </p>
          )}

          <button
            type="submit"
            className="mt-5 w-full rounded-md bg-s1 px-3 py-2 text-sm font-medium text-white transition hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-s1/50"
          >
            Sign in
          </button>
        </form>

        <p className="mt-4 text-center text-[0.6875rem] text-ink-muted">
          Mercedes-Benz programme · internal quality reporting
        </p>
      </div>
    </div>
  )
}
