import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type ThemeMode = 'light' | 'dark' | 'system'

interface ThemeState {
  mode: ThemeMode
  /** The mode actually rendering right now, after resolving 'system'. */
  resolved: 'light' | 'dark'
  setMode: (mode: ThemeMode) => void
  syncResolved: () => void
}

function prefersDark(): boolean {
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false
}

function resolve(mode: ThemeMode): 'light' | 'dark' {
  if (mode === 'system') return prefersDark() ? 'dark' : 'light'
  return mode
}

/**
 * Stamps `data-theme` on <html> so the CSS in index.css can let an explicit
 * toggle beat the OS preference in both directions. 'system' removes the
 * stamp entirely and hands control back to the media query.
 */
function applyToDocument(mode: ThemeMode) {
  const root = document.documentElement
  if (mode === 'system') root.removeAttribute('data-theme')
  else root.setAttribute('data-theme', mode)
}

export const useTheme = create<ThemeState>()(
  persist(
    (set, get) => ({
      mode: 'system',
      resolved: 'light',

      setMode: (mode) => {
        applyToDocument(mode)
        set({ mode, resolved: resolve(mode) })
      },

      syncResolved: () => {
        applyToDocument(get().mode)
        set({ resolved: resolve(get().mode) })
      },
    }),
    {
      name: 'ksk-dashboard-theme',
      partialize: (state) => ({ mode: state.mode }),
      onRehydrateStorage: () => (state) => state?.syncResolved(),
    },
  ),
)

/** Keeps 'system' mode reactive to OS changes while the tab is open. */
export function watchSystemTheme() {
  const query = window.matchMedia('(prefers-color-scheme: dark)')
  const handler = () => {
    if (useTheme.getState().mode === 'system') useTheme.getState().syncResolved()
  }
  query.addEventListener('change', handler)
  return () => query.removeEventListener('change', handler)
}
