import { useEffect, useRef, useState } from 'react'

/** Honours the OS "reduce motion" setting — every animation here checks it. */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false,
  )
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    const handler = () => setReduced(query.matches)
    query.addEventListener('change', handler)
    return () => query.removeEventListener('change', handler)
  }, [])
  return reduced
}

/** easeOutExpo — fast start, long settle. Reads as "landing", not "sliding". */
function easeOutExpo(t: number): number {
  return t === 1 ? 1 : 1 - Math.pow(2, -10 * t)
}

/**
 * Animates a number toward `target` on change.
 *
 * Deliberately skips the animation when the value moves by less than 0.5% of
 * its own magnitude — a live dashboard updates constantly, and re-animating on
 * every tiny WebSocket tick would leave the KPI row permanently twitching.
 */
export function useCountUp(target: number, durationMs = 900): number {
  const reduced = usePrefersReducedMotion()
  const [display, setDisplay] = useState(target)
  const fromRef = useRef(target)
  const frameRef = useRef<number | undefined>(undefined)

  useEffect(() => {
    if (!Number.isFinite(target)) {
      setDisplay(target)
      return
    }

    const from = Number.isFinite(fromRef.current) ? fromRef.current : 0
    const distance = Math.abs(target - from)
    const negligible = distance < Math.max(Math.abs(target) * 0.005, 0.001)

    if (reduced || negligible) {
      fromRef.current = target
      setDisplay(target)
      return
    }

    const start = performance.now()
    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / durationMs)
      const value = from + (target - from) * easeOutExpo(progress)
      setDisplay(value)
      if (progress < 1) {
        frameRef.current = requestAnimationFrame(tick)
      } else {
        fromRef.current = target
      }
    }

    frameRef.current = requestAnimationFrame(tick)
    return () => {
      if (frameRef.current !== undefined) cancelAnimationFrame(frameRef.current)
      fromRef.current = target
    }
  }, [target, durationMs, reduced])

  return display
}
