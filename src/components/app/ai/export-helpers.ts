'use client'

// Export helpers for AI answers: clipboard copy, Excel (tables → xlsx) and
// PDF (print window with brand styling). All client-side, no server needed.

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    // fallback for non-secure contexts
    try {
      const ta = document.createElement('textarea')
      ta.value = text
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      document.body.removeChild(ta)
      return true
    } catch {
      return false
    }
  }
}

/** Extract GFM pipe tables from markdown → array of string matrices. */
export function extractTables(markdown: string): string[][][] {
  const tables: string[][][] = []
  const lines = markdown.split('\n')
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (line.includes('|') && i + 1 < lines.length && /^\s*\|?[\s:-|]+\|[\s:-|]*$/.test(lines[i + 1])) {
      const table: string[][] = []
      const parse = (l: string) =>
        l
          .trim()
          .replace(/^\|/, '')
          .replace(/\|$/, '')
          .split('|')
          .map((c) => c.trim())
      table.push(parse(line))
      i += 2 // skip separator
      while (i < lines.length && lines[i].includes('|')) {
        table.push(parse(lines[i]))
        i++
      }
      tables.push(table)
    } else {
      i++
    }
  }
  return tables
}

/** Export the markdown answer to .xlsx (one sheet per table; text otherwise). */
export async function exportAnswerToExcel(title: string, markdown: string): Promise<boolean> {
  const tables = extractTables(markdown)
  if (tables.length === 0) return false
  const XLSX = await import('xlsx')
  const wb = XLSX.utils.book_new()
  tables.forEach((table, idx) => {
    const ws = XLSX.utils.aoa_to_sheet(table)
    XLSX.utils.book_append_sheet(wb, ws, tables.length === 1 ? 'AI Answer' : `Table ${idx + 1}`)
  })
  const safe = title.replace(/[^\w\s-]/g, '').trim().slice(0, 40) || 'AI Answer'
  XLSX.writeFile(wb, `${safe}.xlsx`)
  return true
}

/** Minimal markdown → HTML for the print/PDF window (tables, bold, lists). */
export function mdToPrintHtml(markdown: string): string {
  const esc = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const inline = (s: string) =>
    esc(s)
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|\W)\*(?!\s)(.+?)\*(?=\W|$)/g, '$1<em>$2</em>')
      .replace(/`(.+?)`/g, '<code>$1</code>')

  const lines = markdown.split('\n')
  const out: string[] = []
  let inList: 'ul' | 'ol' | null = null
  let tableBuf: string[] = []

  const flushList = () => {
    if (inList) {
      out.push(`</${inList}>`)
      inList = null
    }
  }
  const flushTable = () => {
    if (tableBuf.length === 0) return
    const rows = tableBuf
      .filter((l) => !/^\s*\|?[\s:-|]+\|[\s:-|]*$/.test(l))
      .map((l) =>
        l
          .trim()
          .replace(/^\|/, '')
          .replace(/\|$/, '')
          .split('|')
          .map((c) => c.trim())
      )
    if (rows.length) {
      out.push('<table>')
      out.push(
        `<thead><tr>${rows[0].map((c) => `<th>${inline(c)}</th>`).join('')}</tr></thead>`
      )
      out.push('<tbody>')
      for (const r of rows.slice(1)) {
        out.push(`<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`)
      }
      out.push('</tbody></table>')
    }
    tableBuf = []
  }

  for (const line of lines) {
    if (line.includes('|') && line.trim().length > 2) {
      flushList()
      tableBuf.push(line)
      continue
    }
    flushTable()
    const heading = /^(#{1,4})\s+(.*)$/.exec(line)
    const ulItem = /^\s*[-*+]\s+(.*)$/.exec(line)
    const olItem = /^\s*\d+[.)]\s+(.*)$/.exec(line)
    if (heading) {
      flushList()
      const lvl = Math.min(4, heading[1].length + 1)
      out.push(`<h${lvl}>${inline(heading[2])}</h${lvl}>`)
    } else if (ulItem) {
      if (inList !== 'ul') {
        flushList()
        out.push('<ul>')
        inList = 'ul'
      }
      out.push(`<li>${inline(ulItem[1])}</li>`)
    } else if (olItem) {
      if (inList !== 'ol') {
        flushList()
        out.push('<ol>')
        inList = 'ol'
      }
      out.push(`<li>${inline(olItem[1])}</li>`)
    } else if (line.trim() === '') {
      flushList()
    } else {
      flushList()
      out.push(`<p>${inline(line)}</p>`)
    }
  }
  flushList()
  flushTable()
  return out.join('\n')
}

/** Open a branded print window with the answer (user saves as PDF). */
export function printAnswer(title: string, markdown: string): boolean {
  const win = window.open('', '_blank', 'width=820,height=900')
  if (!win) return false
  win.document.write(`<!doctype html>
<html><head><meta charset="utf-8"><title>${title.replace(/</g, '&lt;')}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: 'Segoe UI', system-ui, -apple-system, sans-serif; color: #1c2434; margin: 0; padding: 28px 32px; }
  .brand { display:flex; align-items:center; gap:10px; border-bottom:3px solid #D4AF37; padding-bottom:10px; margin-bottom:6px; }
  .brand .mark { width:34px;height:34px;border-radius:8px;background:#16243d;color:#D4AF37;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:15px; }
  .brand .co { font-weight:700; font-size:15px; color:#16243d; }
  .brand .sub { font-size:10px; letter-spacing:.18em; text-transform:uppercase; color:#B8942C; font-weight:600; }
  h1 { font-size:16px; margin:16px 0 8px; }
  h2,h3,h4 { font-size:14px; margin:12px 0 6px; }
  p { margin:6px 0; line-height:1.55; font-size:12.5px; }
  table { border-collapse:collapse; width:100%; margin:10px 0; font-size:11.5px; }
  th { background:#16243d; color:#fff; text-align:left; padding:6px 8px; }
  td { border-bottom:1px solid #e4e7ee; padding:5px 8px; vertical-align:top; }
  tr:nth-child(even) td { background:#f6f7f9; }
  code { background:#f0f1f4; border-radius:4px; padding:1px 5px; font-size:11px; }
  ul,ol { margin:6px 0 6px 22px; font-size:12.5px; line-height:1.5; }
  .foot { margin-top:22px; border-top:1px solid #e4e7ee; padding-top:8px; color:#8a90a0; font-size:10px; text-align:center; }
  @media print { body { padding: 12mm 14mm; } }
</style></head><body>
<div class="brand"><div class="mark">ML</div><div><div class="co">Landmark Inter Gulf Co. LLC</div><div class="sub">AI Assistant · Answer</div></div></div>
<h1>${title.replace(/</g, '&lt;')}</h1>
${mdToPrintHtml(markdown)}
<div class="foot">Generated by the AI Assistant — verify figures against the ERP before acting on them.</div>
<script>window.onload = () => setTimeout(() => window.print(), 250)</script>
</body></html>`)
  win.document.close()
  return true
}

/** Format money for draft previews. */
export function fmtMoney(n: unknown): string {
  const v = typeof n === 'number' ? n : parseFloat(String(n ?? 0))
  const x = isFinite(v) ? v : 0
  return `SAR ${x.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}
