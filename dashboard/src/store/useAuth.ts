import { DASHBOARD_CREDENTIALS } from '@/lib/config'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface AuthState {
  signedIn: boolean
  /** Who is signed in — shown in the top bar. */
  user: string | null
  signIn: (user: string, password: string) => boolean
  signOut: () => void
}

/**
 * Sign-in gate for the dashboard.
 *
 * ⚠️ This keeps casual visitors out of the screen. It is NOT access control:
 * the credentials ship inside the JavaScript bundle, and the API behind it
 * stays open, so anyone who wants the data can still read it from
 * `GET /records` directly. Treat it as a front door with a sign on it, not a
 * lock. Real protection has to live on the server (see the README).
 */
export const useAuth = create<AuthState>()(
  persist(
    (set) => ({
      signedIn: false,
      user: null,

      signIn: (user, password) => {
        const ok =
          user.trim().toLowerCase() === DASHBOARD_CREDENTIALS.user &&
          password === DASHBOARD_CREDENTIALS.password
        if (ok) set({ signedIn: true, user: user.trim() })
        return ok
      },

      signOut: () => set({ signedIn: false, user: null }),
    }),
    {
      name: 'ksk-dashboard-auth',
      // Survives a reload so nobody has to sign in again mid-presentation.
      partialize: (state) => ({ signedIn: state.signedIn, user: state.user }),
    },
  ),
)
