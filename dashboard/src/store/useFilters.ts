import { create } from 'zustand'
import { persist } from 'zustand/middleware'

/**
 * Cross-page filter state.
 *
 * `model` is the global filter from the top bar and persists to localStorage,
 * so it survives navigation and reloads. The drill-down filters (`errorCode`,
 * `partType`, `shift`) are set by clicking a chart segment and are deliberately
 * NOT persisted — a saved drill-down would silently scope every future session
 * to a slice the user forgot they picked.
 */
interface FiltersState {
  model: string
  errorCode: string | null
  partType: string | null
  shift: string | null
  weeks: number
  setModel: (model: string) => void
  toggleErrorCode: (code: string | null) => void
  togglePartType: (partType: string | null) => void
  toggleShift: (shift: string | null) => void
  setWeeks: (weeks: number) => void
  clearDrilldown: () => void
}

export const ALL_MODELS = 'ALL'

export const useFilters = create<FiltersState>()(
  persist(
    (set, get) => ({
      model: ALL_MODELS,
      errorCode: null,
      partType: null,
      shift: null,
      weeks: 12,

      setModel: (model) => set({ model }),
      // Clicking the active segment again clears it — click-to-filter and
      // click-to-unfilter are the same gesture.
      toggleErrorCode: (code) => set({ errorCode: get().errorCode === code ? null : code }),
      togglePartType: (partType) =>
        set({ partType: get().partType === partType ? null : partType }),
      toggleShift: (shift) => set({ shift: get().shift === shift ? null : shift }),
      setWeeks: (weeks) => set({ weeks }),
      clearDrilldown: () => set({ errorCode: null, partType: null, shift: null }),
    }),
    {
      name: 'ksk-dashboard-filters',
      partialize: (state) => ({ model: state.model, weeks: state.weeks }),
    },
  ),
)
