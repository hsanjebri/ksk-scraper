/**
 * CSV export for the Reports page.
 *
 * Two details that matter more than they look:
 *
 * 1. The BOM. Excel decides a CSV's encoding by sniffing, and without a UTF-8
 *    byte-order mark it assumes the local ANSI codepage — which turns every
 *    accented French comment ("pas de continuité") into mojibake. Since this
 *    file exists to be opened in Excel by people on the plant floor, the BOM
 *    is not optional.
 *
 * 2. Quoting. The site's comments routinely contain commas and quotes, so
 *    every field is quoted and internal quotes are doubled per RFC 4180.
 */

function escapeCell(value: unknown): string {
  if (value === null || value === undefined) return '""'
  const text = String(value).replace(/"/g, '""')
  return `"${text}"`
}

export function toCsv(headers: string[], rows: unknown[][]): string {
  const lines = [headers.map(escapeCell).join(','), ...rows.map((r) => r.map(escapeCell).join(','))]
  // CRLF: Excel is happiest with it and every other tool tolerates it.
  return `﻿${lines.join('\r\n')}\r\n`
}

export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  // Revoking immediately can cancel the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
