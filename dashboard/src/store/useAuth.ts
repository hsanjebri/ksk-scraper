import {
  ApiUnavailableError,
  fetchCurrentUser,
  signInRequest,
  signOutRequest,
  type SignInOutcome,
} from '@/lib/api'
import { create } from 'zustand'

/**
 * `checking`    asking the server whether the session cookie is valid
 * `signedOut`   show the sign-in page
 * `signedIn`    show the dashboard
 * `unavailable` the server could not be reached to find out
 */
export type AuthStatus = 'checking' | 'signedOut' | 'signedIn' | 'unavailable'

interface AuthState {
  status: AuthStatus
  user: string | null
  /** Result of the last sign-in attempt, for the form's message. */
  lastAttempt: Exclude<SignInOutcome, 'ok'> | null
  check: () => Promise<void>
  signIn: (username: string, password: string) => Promise<void>
  signOut: () => Promise<void>
  /** Called when any request comes back 401: the session ended server-side. */
  expire: () => void
}

/**
 * Dashboard sign-in, backed by the server.
 *
 * The session itself is an HttpOnly cookie set by the backend: nothing
 * secret is held here or in localStorage, and no credential ships in the
 * JavaScript bundle. The server decides on every request.
 */
export const useAuth = create<AuthState>((set) => ({
  status: 'checking',
  user: null,
  lastAttempt: null,

  async check() {
    try {
      const { user } = await fetchCurrentUser()
      set({ status: 'signedIn', user })
    } catch (error) {
      set({ status: error instanceof ApiUnavailableError ? 'unavailable' : 'signedOut', user: null })
    }
  },

  async signIn(username, password) {
    const outcome = await signInRequest(username, password)
    if (outcome !== 'ok') {
      set({ lastAttempt: outcome })
      return
    }
    set({ lastAttempt: null })
    await useAuth.getState().check()
  },

  async signOut() {
    await signOutRequest()
    set({ status: 'signedOut', user: null, lastAttempt: null })
  },

  expire() {
    set({ status: 'signedOut', user: null })
  },
}))
