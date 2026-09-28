/**
 * Everything the dashboard shows comes from the rework application, where
 * operators type part names, comments and team names freely. It is untrusted
 * input: a comment such as `<img src=x onerror=...>` would run as code in the
 * browser of whoever hovers the chart.
 *
 * React escapes text on its own. These helpers cover the two places where it
 * does not: HTML strings handed to ECharts tooltips (rendered as innerHTML),
 * and cells written into a CSV file that Excel will open.
 */

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}

/** Text made safe to place inside an HTML element or quoted attribute. */
export function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch])
}

/**
 * A colour safe to place in a style attribute: a hex colour or rgb()/rgba()
 * with numbers only. Anything else (for example `red;background:url(...)`)
 * is dropped, never passed through.
 */
export function safeCssColor(value: unknown): string | null {
  const text = String(value ?? '').trim()
  if (/^#[0-9a-f]{3,8}$/i.test(text)) return text
  if (/^rgba?\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+\s*(,\s*[\d.]+\s*)?\)$/i.test(text)) return text
  return null
}

/**
 * Spreadsheet formula injection: Excel treats a cell starting with = + - @
 * (or a tab / carriage return before them) as a formula, which can fetch
 * URLs or run commands on the machine that opens the export. The OWASP
 * recommendation is to prefix such cells with an apostrophe so they display
 * as text. A leading "-" is common in real comments; the apostrophe keeps it
 * readable while making it inert.
 */
export function neutraliseFormula(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value
}
