import { usePrefersReducedMotion } from '@/hooks/useMotion'
import clsx from 'clsx'
import type { ReactNode } from 'react'

/**
 * Staggered entrance for a group of cards.
 *
 * The stagger is capped and short (max ~200ms total) — a long cascade looks
 * impressive once and then costs the user time on every navigation. Reduced
 * motion drops it entirely.
 */
export function Reveal({
  index = 0,
  className,
  children,
}: {
  index?: number
  className?: string
  children: ReactNode
}) {
  const reduced = usePrefersReducedMotion()

  // h-full so a Reveal wrapper never breaks the equal-height grid it sits in.
  if (reduced) return <div className={clsx('h-full', className)}>{children}</div>

  return (
    <div
      className={clsx('motion-reveal h-full', className)}
      style={{ animationDelay: `${Math.min(index, 8) * 45}ms` }}
    >
      {children}
    </div>
  )
}
