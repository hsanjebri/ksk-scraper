import { DARK_TOKENS, LIGHT_TOKENS, type VizTokens } from '@/lib/viz-tokens'
import { ALL_MODELS, useFilters } from '@/store/useFilters'
import { useRecords } from '@/store/useRecords'
import { useTheme } from '@/store/useTheme'
import type { KskRecord } from '@/types'
import { useEffect, useMemo, useState } from 'react'

export function useVizTokens(): VizTokens {
  const resolved = useTheme((s) => s.resolved)
  return resolved === 'dark' ? DARK_TOKENS : LIGHT_TOKENS
}

/** A clock that re-renders on an interval, for live-ticking elapsed times. */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])
  return now
}

/**
 * The single source of "what the page is currently looking at": the global
 * model filter plus any chart drill-down, applied in one place so every chart
 * on a page renders against the identical slice.
 */
export function useFilteredRecords(): {
  records: KskRecord[]
  /** Scoped by model only — for charts that break down BY the drilled dimension. */
  modelScoped: KskRecord[]
  hasDrilldown: boolean
} {
  const all = useRecords((s) => s.records)
  const model = useFilters((s) => s.model)
  const errorCode = useFilters((s) => s.errorCode)
  const partType = useFilters((s) => s.partType)
  const shift = useFilters((s) => s.shift)

  return useMemo(() => {
    const modelScoped =
      model === ALL_MODELS ? all : all.filter((record) => record.model === model)

    let records = modelScoped
    if (errorCode) {
      records = records.filter((record) =>
        record.errorCodes.some((entry) => entry.code === errorCode),
      )
    }
    if (partType) {
      records = records.filter((record) => record.partType === partType)
    }
    if (shift) {
      records = records.filter((record) => record.defectShift === shift)
    }

    return {
      records,
      modelScoped,
      hasDrilldown: Boolean(errorCode || partType || shift),
    }
  }, [all, model, errorCode, partType, shift])
}
