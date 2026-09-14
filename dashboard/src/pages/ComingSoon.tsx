import { Card } from '@/components/ui/primitives'

/**
 * Placeholder for the pages after Overview. Deliberately lists exactly what
 * each page will contain rather than showing a blank "coming soon" — so the
 * build order stays visible while working through them one at a time.
 */
export function ComingSoon({ title, items }: { title: string; items: string[] }) {
  return (
    <Card className="p-6">
      <div className="flex items-center gap-2">
        <h2 className="text-sm font-semibold text-ink">{title}</h2>
        <span className="rounded-full bg-ink/6 px-2 py-0.5 text-[0.625rem] font-medium tracking-wide text-ink-muted uppercase">
          next up
        </span>
      </div>
      <p className="mt-1.5 text-xs text-ink-secondary">
        Overview is built first and wired to the live API. This page is planned to carry:
      </p>
      <ul className="mt-4 space-y-2">
        {items.map((item) => (
          <li key={item} className="flex items-start gap-2.5 text-xs text-ink-secondary">
            <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-s1" aria-hidden />
            {item}
          </li>
        ))}
      </ul>
    </Card>
  )
}
