// Client-side CSV generation + download (Excel-friendly: BOM + CRLF)
'use client'

function escapeCsvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return ''
  const s = String(value)
  // Quote cells containing separators, quotes, or newlines; escape inner quotes
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`
  }
  return s
}

/**
 * Build a CSV string from headers + rows.
 */
export function buildCsv(headers: string[], rows: (string | number | null | undefined)[][]): string {
  const lines = [headers.map(escapeCsvCell).join(','), ...rows.map((r) => r.map(escapeCsvCell).join(','))]
  return `\uFEFF${lines.join('\r\n')}` // BOM so Excel detects UTF-8
}

/**
 * Build CSV from an array of records (objects) using the given column map.
 */
export function buildCsvFromRecords<T extends Record<string, unknown>>(
  records: T[],
  columns: { header: string; value: (record: T) => string | number | null | undefined }[]
): string {
  return buildCsv(
    columns.map((c) => c.header),
    records.map((r) => columns.map((c) => c.value(r)))
  )
}

/** Trigger a browser download of a CSV file. */
export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;'})
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename.endsWith('.csv') ? filename : `${filename}.csv`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** Timestamped filename helper: "salary-sheet-Sep-2026-20261007-0659.csv" */
export function csvFilename(base: string, suffix?: string): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`
  return `${base}${suffix ? `-${suffix}` : ''}-${stamp}.csv`
}
