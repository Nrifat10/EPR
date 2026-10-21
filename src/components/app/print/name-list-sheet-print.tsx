'use client'

// Name List sheet print — the boss's two mirror-style A4 templates
// (upload/Name_List_Interview.png + Name_List_Mobilization.png):
//
//   • Striped letterhead placeholder zones (top 35mm / bottom 22mm) — replaced
//     by uploaded letterhead artwork when configured.
//   • Header: "NAME LIST" + gold subject subtitle left · navy capsule with a
//     gold ring holding the List No. centre · "Client" + company right.
//   • Gold rule broken by a centre diamond.
//   • Cream info bar (Subject badge | Date & Time / Site | Location / Date |
//     Positions / Reference | Total Workers) + small reference line.
//   • Workers table — navy rounded-end header, gold-ring number circles,
//     horizontal-only separators; Interview variant prints tick-box results
//     (or the saved result), Mobilization prints passport + blood-group red
//     capsules.
//   • Trade summary chips (left) + navy "Total X Workers" capsule (right).
//   • Signature cards with dashed stamp circles: "PREPARED BY / Company
//     Stamp" + "INTERVIEWED BY (CLIENT) / Client Stamp" (interview) or
//     "RECEIVED BY (CLIENT / SITE) / Site Stamp" (mobilization).
//   • Explicit A4 pages with thead repeated on every page and a
//     "Page X of Y" footer; several lists can print in one PDF.
//
// The Columns setting hides data everywhere (print AND Excel): changes are
// saved to the list instantly so the server-side Excel export always matches.
import { useEffect, useMemo, useState } from 'react'
import { Columns3, FileSpreadsheet, Printer, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { usePageRule } from '@/components/app/print/print-page-rule'
import { useAppStore } from '@/lib/store'
import type {
  AppSettings,
  LetterheadConfig,
  NameListColumnKey,
  NameListColumns,
  NameListDetail,
  NameListWorkerRow,
} from '@/lib/types'
import {
  NL_ALL_COLUMNS,
  effectiveColumns,
  formatSaudiMobile,
  nlFormatDate,
  nlOrderedColumns,
  printFontTier,
  printNameFontTier,
  rememberColumnDefaults,
} from '@/lib/name-list-utils'

// ── Brand palette (the boss's specified values) ──────────────────────────────
const NAVY = '#132A4A'
const DARK_NAVY = '#0C1D33'
const GOLD = '#C0934C'
const LIGHT_GOLD = '#E1B169'
const CREAM = '#FAF7F1'
const BORDER = '#E6E1D6'
const MUTED = '#6B7488'
const ROW_SEP = '#EFEAE0'
const STRIPE_A = '#F3F5F8'
const STRIPE_CAPTION = '#9AA5B5'
const BLOOD_BG = '#FBE9E7'
const BLOOD_FG = '#B03A2E'

const DOC_FONT = "'Cairo', 'Tajawal', 'Segoe UI', Tahoma, sans-serif"

// ── A4 pagination geometry ──────────────────────────────────────────────────
const PAGE_W_MM = 210
const PAGE_H_MM = 296.5 // 0.5mm print-pipeline slack (Chrome blank-page fix)
const SIDE_PAD_MM = 8
const FOOTER_MM = 4

const DEFAULT_LETTERHEAD: LetterheadConfig = {
  mode: 'none',
  headerImage: null,
  footerImage: null,
  fullPageImage: null,
  showCompanyDetails: true,
  headerHeightMm: 30,
  footerHeightMm: 18,
}

function geometryFor(letterhead: LetterheadConfig): { topMm: number; bottomMm: number } {
  const hasFull = letterhead.mode === 'full' && letterhead.fullPageImage
  const hasHeader =
    (letterhead.mode === 'header' || letterhead.mode === 'header_footer') && letterhead.headerImage
  const hasFooter = letterhead.mode === 'header_footer' && letterhead.footerImage
  if (hasFull) {
    return {
      topMm: letterhead.headerHeightMm + 4,
      bottomMm: Math.max(letterhead.footerHeightMm + 4, 12),
    }
  }
  if (hasHeader && hasFooter) {
    return { topMm: letterhead.headerHeightMm + 3, bottomMm: letterhead.footerHeightMm + 3 }
  }
  if (hasHeader) return { topMm: letterhead.headerHeightMm + 3, bottomMm: 12 }
  // 'none' — the boss's mockup: striped zones, top 35mm / bottom 22mm
  return { topMm: 35, bottomMm: 22 }
}

/** Small solid gold diamond — the template's recurring ornament. */
function GoldDiamond({ size = 5 }: { size?: number }) {
  return (
    <span
      aria-hidden
      className="inline-block shrink-0 rotate-45"
      style={{ width: `${size}px`, height: `${size}px`, background: GOLD }}
    />
  )
}

// ── Column geometry ──────────────────────────────────────────────────────────
/** Preferred mm widths per column (name gets the remainder). */
const COL_W: Record<NameListColumnKey, number> = {
  trade: 17,
  experience: 9,
  nationality: 15,
  iqama: 20,
  passport: 17,
  mobile: 19,
  blood: 11,
  iqamaExpiry: 18,
  employeeId: 26,
  result: 26,
  remarks: 24,
}

// ── Row height estimation for pagination ─────────────────────────────────────
function estLines(text: string, charsPerLine: number): number {
  if (!text) return 1
  const lines = Math.ceil(text.length / charsPerLine)
  return Math.max(1, Math.min(4, lines))
}

function rowHeightMm(w: NameListWorkerRow, hasResultBoxes: boolean, remarksShown: boolean): number {
  let h = 8.4 // base row (name + padding) — raised with the bigger print fonts
  if (hasResultBoxes) h = 10.4 // tick-box triple needs more room
  if (remarksShown) h += Math.max(0, estLines(w.remarks ?? '', 16) - 1) * 2.2
  h += Math.max(0, estLines(w.staff.fullName, 24) - 1) * 2.2
  return h
}

// ── The print dialog ─────────────────────────────────────────────────────────

export function NameListSheetPrintDialog({
  lists,
  letterhead,
  open,
  onOpenChange,
  onColumnsSaved,
}: {
  /** One or several lists (multi-list day print renders them back-to-back). */
  lists: NameListDetail[]
  letterhead?: LetterheadConfig | null
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Called after column settings were persisted to a list. */
  onColumnsSaved?: (listId: string, columns: NameListColumns) => void
}) {
  const settings = useAppStore((s) => s.settings)
  usePageRule(open, 'size: A4 portrait; margin: 0;')

  // local working copies of the per-list column settings
  const [colsByList, setColsByList] = useState<Record<string, NameListColumns>>({})
  useEffect(() => {
    if (open) setColsByList({})
  }, [open, lists])

  const resolved = useMemo(() => {
    const map: Record<string, NameListColumns> = {}
    for (const l of lists) {
      map[l.id] =
        colsByList[l.id] ?? effectiveColumns(l.subjectKind, l.columns ?? null)
    }
    return map
  }, [lists, colsByList])

  const first = lists[0]
  const totalWorkers = lists.reduce((s, l) => s + l.workers.length, 0)

  async function setColumns(list: NameListDetail, next: NameListColumns) {
    setColsByList((p) => ({ ...p, [list.id]: next }))
    // persist instantly so the server-side Excel export matches the print
    try {
      const { api } = await import('@/lib/api-client')
      await api.put(`/api/name-lists/${list.id}`, { columns: next })
      onColumnsSaved?.(list.id, next)
    } catch {
      /* keep local print working even if the save fails */
    }
  }

  if (!open || !first) return null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="flex max-h-[92vh] w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-[900px] print:static print:max-h-none print:w-full print:max-w-none print:translate-x-0 print:translate-y-0 print:overflow-visible print:rounded-none print:border-0 print:p-0 print:shadow-none"
      >
        <DialogTitle className="sr-only">Name list print preview</DialogTitle>
        <DialogDescription className="sr-only">
          Printable A4 name list with letterhead zones, info bar, workers table, trade summary chips and signature cards.
        </DialogDescription>

        {/* Top button bar — hidden when printing */}
        <div className="print-hidden flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">
              {lists.length === 1
                ? `Name List — ${first.listNo}`
                : `${lists.length} name lists · ${totalWorkers} workers`}
            </p>
            <p className="truncate text-xs text-muted-foreground">
              A4 · Mirror template · {lists.length === 1 ? first.subjectName : 'multi-list day print'}
              {lists.length === 1 ? ` · ${first.clientName}` : ''}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {lists.length === 1 ? (
              <>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" size="sm">
                      <Columns3 className="h-4 w-4" />
                      Columns
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent align="end" className="w-72">
                    <p className="mb-1 text-xs font-semibold">Visible columns</p>
                    <p className="mb-2 text-[11px] text-muted-foreground">
                      # and Employee Name are always shown. Hidden columns never appear in the PDF or
                      the Excel export. Changes save to this list instantly.
                    </p>
                    <div className="grid gap-1.5">
                      {NL_ALL_COLUMNS.map(({ key, label }) => {
                        const disabled =
                          (first.subjectKind === 'mobilization' && (key === 'experience' || key === 'result')) ||
                          (first.subjectKind === 'interview' && (key === 'passport' || key === 'blood'))
                        const checked = resolved[first.id]?.[key] === true
                        return (
                          <Label
                            key={key}
                            className={`flex items-center gap-2 text-xs font-normal ${disabled ? 'opacity-40' : ''}`}
                          >
                            <Checkbox
                              checked={checked}
                              disabled={disabled}
                              onCheckedChange={(v) =>
                                setColumns(first, { ...resolved[first.id], [key]: v === true })
                              }
                            />
                            {label}
                          </Label>
                        )
                      })}
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      className="mt-2 w-full"
                      onClick={() => {
                        rememberColumnDefaults(first.subjectKind, resolved[first.id])
                      }}
                    >
                      Remember as my default for {first.subjectKind} lists
                    </Button>
                  </PopoverContent>
                </Popover>
                <Button variant="outline" size="sm" asChild>
                  <a href={`/api/name-lists/${first.id}/excel`} download>
                    <FileSpreadsheet className="h-4 w-4" />
                    Excel
                  </a>
                </Button>
              </>
            ) : null}
            <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
              <X className="h-4 w-4" />
              Close
            </Button>
            <Button size="sm" onClick={() => window.print()}>
              <Printer className="h-4 w-4" />
              Print / Save as PDF
            </Button>
          </div>
        </div>

        {/* Scrollable preview area — stacked A4 pages */}
        <div className="nice-scrollbar min-h-0 flex-1 overflow-auto bg-neutral-100 p-4 dark:bg-neutral-900 print:flex-none print:overflow-visible print:bg-transparent print:p-0">
          <div
            className="print-area mx-auto flex w-full flex-col items-center gap-6 bg-transparent [print-color-adjust:exact] [-webkit-print-color-adjust:exact] print:gap-0"
            style={{ fontFamily: DOC_FONT }}
          >
            {lists.map((l) => (
              <NameListSheetDocument
                key={l.id}
                list={l}
                columns={resolved[l.id]}
                letterhead={letterhead ?? DEFAULT_LETTERHEAD}
                settings={settings}
              />
            ))}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ── The document (one list = one or more A4 pages) ──────────────────────────

export function NameListSheetDocument({
  list,
  columns,
  letterhead,
  settings,
}: {
  list: NameListDetail
  columns: NameListColumns
  letterhead: LetterheadConfig
  settings: AppSettings
}) {
  const geo = geometryFor(letterhead)
  const isMob = list.subjectKind === 'mobilization'
  const cols = nlOrderedColumns(list.subjectKind, columns)
  const fontTier = printFontTier(cols.length + 2)
  const nameFontTier = printNameFontTier(cols.length + 2)

  const hasResultCol = cols.some((c) => c.key === 'result')
  const hasRemarks = cols.some((c) => c.key === 'remarks')

  // ── pagination (flow-fill lite) ──
  const headerMm = 12.5 // title row
  const ruleMm = 3.2 // gold rule
  const infoBarMm = 13.5 // cream info bar
  const refLineMm = 4.5 // reference line
  const theadMm = 6.2 // table header
  const chipsMm = 8 // trade chips + total capsule
  const signaturesMm = 30 // signature cards
  const page1FixedMm = headerMm + ruleMm + infoBarMm + refLineMm + theadMm + 3.5
  const contHeaderMm = 8 // continuation mini header + thead

  const rowsMm = list.workers.map((w) => rowHeightMm(w, isMob ? false : hasResultCol && !w.result, hasRemarks))
  const tailMm = chipsMm + 2 + signaturesMm

  const availFirst = PAGE_H_MM - geo.topMm - (geo.bottomMm + FOOTER_MM) - page1FixedMm
  const availRest = PAGE_H_MM - geo.topMm - (geo.bottomMm + FOOTER_MM) - contHeaderMm

  // chunk workers
  const chunks: number[][] = []
  let cur: number[] = []
  let used = 0
  let limit = availFirst
  for (let i = 0; i < list.workers.length; i++) {
    const h = rowsMm[i]
    if (used + h > limit && cur.length > 0) {
      chunks.push(cur)
      cur = []
      used = 0
      limit = availRest
    }
    cur.push(i)
    used += h
  }
  chunks.push(cur)

  // tail (chips + signatures) flows onto the last items page if it fits,
  // otherwise continues on a fresh page (never stranded without the chips)
  const lastChunkUsed = used
  const cap = chunks.length === 1 ? availFirst : availRest
  let tailOnLastItemsPage = lastChunkUsed + tailMm <= cap
  const pages: { rows: number[]; hasTail: boolean }[] = chunks.map((rows, i) => ({
    rows,
    hasTail: i === chunks.length - 1 && tailOnLastItemsPage,
  }))
  if (!tailOnLastItemsPage) {
    pages.push({ rows: [], hasTail: true })
    tailOnLastItemsPage = true
  }
  const totalPages = pages.length

  // trade summary chips
  const trades = new Map<string, number>()
  for (const w of list.workers) {
    const t = w.staff.categoryName ?? w.staff.position ?? 'Uncategorized'
    trades.set(t, (trades.get(t) ?? 0) + 1)
  }

  const th = 'px-1 py-[3px] text-center align-middle text-[8.2px] font-bold uppercase tracking-[0.04em] text-white'
  const rowFont = fontTier

  const letterheadArt = letterhead.mode === 'full' && letterhead.fullPageImage
  const headerArt =
    (letterhead.mode === 'header' || letterhead.mode === 'header_footer') && letterhead.headerImage
  const footerArt = letterhead.mode === 'header_footer' && letterhead.footerImage

  return (
    <>
      {pages.map((plan, pageIdx) => {
        const isLast = pageIdx === totalPages - 1
        return (
          <div
            key={pageIdx}
            className="doc-page relative shrink-0 overflow-hidden bg-white text-neutral-900 shadow-sm print:shadow-none"
            style={{
              width: `${PAGE_W_MM}mm`,
              height: `${PAGE_H_MM}mm`,
              breakAfter: isLast ? 'auto' : 'page',
              breakInside: 'avoid',
            }}
          >
            {/* letterhead artwork / striped placeholder zones */}
            {letterheadArt ? (
              <img
                src={letterhead.fullPageImage as string}
                alt=""
                aria-hidden
                className="pointer-events-none absolute inset-0 z-0 h-full w-full object-fill"
              />
            ) : (
              <>
                {headerArt ? (
                  <img
                    src={letterhead.headerImage as string}
                    alt=""
                    aria-hidden
                    className="pointer-events-none absolute left-0 top-0 z-0 w-full object-fill"
                    style={{ height: `${letterhead.headerHeightMm}mm` }}
                  />
                ) : (
                  <div
                    aria-hidden
                    className="pointer-events-none absolute inset-x-0 top-0 z-0 flex flex-col items-center justify-center"
                    style={{
                      height: `${geo.topMm}mm`,
                      background: `repeating-linear-gradient(45deg, ${STRIPE_A} 0px, ${STRIPE_A} 5px, #ffffff 5px, #ffffff 11px)`,
                      borderBottom: '1px dashed #C9D2DE',
                    }}
                  >
                    <p className="text-center text-[7.5px] font-semibold uppercase tracking-[0.16em]" style={{ color: STRIPE_CAPTION }}>
                      Letterhead Header Area
                      <span className="mx-1.5 opacity-50">|</span>
                      <span lang="ar" dir="rtl" className="tracking-normal">مساحة رأس الخطاب</span>
                    </p>
                  </div>
                )}
                {footerArt ? (
                  <img
                    src={letterhead.footerImage as string}
                    alt=""
                    aria-hidden
                    className="pointer-events-none absolute bottom-0 left-0 z-0 w-full object-fill"
                    style={{ height: `${letterhead.footerHeightMm}mm` }}
                  />
                ) : letterhead.mode !== 'header' ? (
                  <div
                    aria-hidden
                    className="pointer-events-none absolute inset-x-0 bottom-0 z-0 flex flex-col items-center justify-center"
                    style={{
                      height: `${geo.bottomMm}mm`,
                      background: `repeating-linear-gradient(45deg, ${STRIPE_A} 0px, ${STRIPE_A} 5px, #ffffff 5px, #ffffff 11px)`,
                      borderTop: '1px dashed #C9D2DE',
                    }}
                  >
                    <p className="text-center text-[7.5px] font-semibold uppercase tracking-[0.16em]" style={{ color: STRIPE_CAPTION }}>
                      Letterhead Footer Area
                      <span className="mx-1.5 opacity-50">|</span>
                      <span lang="ar" dir="rtl" className="tracking-normal">مساحة ذيل الخطاب</span>
                    </p>
                  </div>
                ) : null}
              </>
            )}

            {/* status stamp over the letterhead zone (page 1) */}
            {pageIdx === 0 && list.status !== 'draft' ? (
              <div
                className="pointer-events-none absolute z-20"
                style={{ top: `${Math.max(geo.topMm - 7, 2)}mm`, right: `${SIDE_PAD_MM}mm` }}
              >
                <span
                  className="inline-block rounded border-[2.5px] bg-white/95 px-2 py-px text-[8px] font-black uppercase tracking-[0.18em]"
                  style={{
                    borderColor:
                      list.status === 'sent'
                        ? '#d97706'
                        : list.status === 'completed'
                          ? '#059669'
                          : '#737373',
                    color:
                      list.status === 'sent'
                        ? '#b45309'
                        : list.status === 'completed'
                          ? '#047857'
                          : '#525252',
                    transform: 'rotate(-3deg)',
                  }}
                >
                  {list.status}
                </span>
              </div>
            ) : null}

            {/* content */}
            <div
              className="absolute inset-x-0 top-0 z-10 flex h-full flex-col"
              style={{
                paddingTop: `${geo.topMm}mm`,
                paddingBottom: `${geo.bottomMm + FOOTER_MM}mm`,
                paddingLeft: `${SIDE_PAD_MM}mm`,
                paddingRight: `${SIDE_PAD_MM}mm`,
              }}
            >
              {pageIdx === 0 ? (
                <>
                  {/* 1 ─ header row: NAME LIST + subject · list-no capsule · client */}
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <h1
                        className="text-[17px] font-extrabold uppercase leading-[1.1] tracking-[0.05em]"
                        style={{ color: NAVY }}
                      >
                        Name List
                      </h1>
                      <p
                        className="mt-[1mm] whitespace-nowrap text-[7px] font-bold uppercase leading-none tracking-[0.22em]"
                        style={{ color: GOLD }}
                      >
                        {list.subjectName} List
                      </p>
                    </div>
                    <div className="shrink-0 rounded-full p-[2px]" style={{ background: GOLD }}>
                      <div className="rounded-full px-5 py-[4px] text-center" style={{ background: NAVY }}>
                        <p
                          className="whitespace-nowrap text-[6.5px] font-bold uppercase tracking-[0.16em]"
                          style={{ color: LIGHT_GOLD }}
                        >
                          List No.
                        </p>
                        <p className="whitespace-nowrap text-[11px] font-extrabold leading-tight text-white">
                          {list.listNo}
                        </p>
                      </div>
                    </div>
                    <div className="min-w-0 flex-1 text-right">
                      <p
                        className="text-[6.5px] font-semibold uppercase tracking-[0.14em]"
                        style={{ color: MUTED }}
                      >
                        Client
                      </p>
                      <p
                        className="mt-[0.6mm] truncate text-[10.5px] font-bold leading-tight"
                        style={{ color: NAVY }}
                        title={list.clientName}
                      >
                        {list.clientName}
                      </p>
                    </div>
                  </div>

                  {/* 2 ─ gold rule with centre diamond */}
                  <div className="mt-[1.6mm] flex items-center gap-[5px]">
                    <span className="h-[1.5px] flex-1 rounded-full" style={{ background: GOLD }} />
                    <GoldDiamond size={5} />
                    <span className="h-[1.5px] flex-1 rounded-full" style={{ background: GOLD }} />
                  </div>

                  {/* 3 ─ cream info bar */}
                  <div
                    className="mt-[1.8mm] grid gap-x-3 gap-y-1 rounded-md px-3 py-[2.4mm]"
                    style={{
                      background: CREAM,
                      border: `1px solid ${BORDER}`,
                      gridTemplateColumns: 'auto 1fr 1fr 1.3fr auto',
                    }}
                  >
                    {/* subject badge */}
                    <div>
                      <p className="text-[6px] font-semibold uppercase tracking-[0.12em]" style={{ color: MUTED }}>
                        Subject
                      </p>
                      <span
                        className="mt-[0.5mm] inline-block rounded-full px-2.5 py-[1.2px] text-[7.5px] font-bold uppercase tracking-[0.08em] text-white"
                        style={{ background: list.subjectColor }}
                      >
                        {list.subjectName}
                      </span>
                    </div>
                    {isMob ? (
                      <>
                        <InfoField label="Project / Site" value={list.projectName ?? list.location ?? '—'} />
                        <InfoField label="Mobilization Date" value={nlFormatDate(list.date)} />
                        <InfoField
                          label="Reference"
                          value={
                            [
                              list.refInterviewListNo ? `Interview ${list.refInterviewListNo}` : null,
                              list.refPoNo ? `PO ${list.refPoNo}` : null,
                            ]
                              .filter(Boolean)
                              .join(' · ') || '—'
                          }
                        />
                      </>
                    ) : (
                      <>
                        <InfoField
                          label="Date & Time"
                          value={`${nlFormatDate(list.date)}${list.time ? ` • ${list.time}` : ''}`}
                        />
                        <InfoField label="Location" value={list.location ?? '—'} />
                        <InfoField label="Positions" value={list.positions.join(', ') || '—'} />
                      </>
                    )}
                    <div className="text-right">
                      <p className="text-[6px] font-semibold uppercase tracking-[0.12em]" style={{ color: MUTED }}>
                        Total Workers
                      </p>
                      <p className="text-[13px] font-extrabold leading-tight" style={{ color: NAVY }}>
                        {list.workers.length}
                      </p>
                    </div>
                  </div>

                  {/* 4 ─ reference line */}
                  <p className="mt-[1.2mm] text-[6.8px] leading-snug" style={{ color: '#4B5563' }}>
                    {isMob ? (
                      <>
                        {list.refInterviewListNo ? (
                          <>
                            Created from interview list{' '}
                            <b style={{ color: NAVY }}>{list.refInterviewListNo}</b> (Selected workers)
                            {' · '}
                          </>
                        ) : null}
                        <b>Client contact:</b> {list.clientContact ?? list.client?.contactPerson ?? '—'}
                        {list.clientPhone ?? list.client?.phone ? (
                          <> • {list.clientPhone ?? list.client?.phone}</>
                        ) : null}
                      </>
                    ) : (
                      <>
                        <b>Client contact:</b>{' '}
                        {list.clientContact ?? list.client?.contactPerson ?? '—'}
                        {list.clientPhone ?? list.client?.phone ? (
                          <> • {list.clientPhone ?? list.client?.phone}</>
                        ) : null}
                        {list.transport ? (
                          <>
                            {' · '}
                            <b>Transport:</b> {list.transport}
                          </>
                        ) : null}
                      </>
                    )}
                  </p>

                  {/* 5 ─ workers table */}
                  <div className="mt-[1.6mm]">
                    <SheetTable
                      list={list}
                      cols={cols}
                      rowIdxs={plan.rows}
                      th={th}
                      rowFont={rowFont}
                      nameFont={nameFontTier}
                      isMob={isMob}
                    />
                  </div>
                </>
              ) : (
                <>
                  {/* continuation mini header + repeated thead */}
                  <div className="flex items-center justify-between gap-3 pb-[1.2mm]">
                    <p className="text-[8px] font-bold uppercase tracking-[0.1em]" style={{ color: NAVY }}>
                      {list.subjectName} List — continued
                    </p>
                    <p className="text-[7px] font-semibold" style={{ color: MUTED }}>
                      {list.listNo} · {list.clientName}
                    </p>
                  </div>
                  <SheetTable
                    list={list}
                    cols={cols}
                    rowIdxs={plan.rows}
                    th={th}
                    rowFont={rowFont}
                    nameFont={nameFontTier}
                    isMob={isMob}
                  />
                </>
              )}

              {/* tail — trade chips + total capsule + signature cards */}
              {plan.hasTail ? (
                <div className="mt-[2.2mm]">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-[4px]">
                      {[...trades.entries()].map(([t, n]) => (
                        <span
                          key={t}
                          className="rounded-full px-2 py-[1.6px] text-[7.5px]"
                          style={{ border: `1px solid ${BORDER}`, color: '#374151' }}
                        >
                          {t} <b style={{ color: NAVY }}>{n}</b>
                        </span>
                      ))}
                    </div>
                    <span
                      className="rounded-full px-3 py-[2px] text-[8px] font-bold text-white"
                      style={{ background: NAVY }}
                    >
                      Total <span style={{ color: LIGHT_GOLD }}>{list.workers.length}</span> Workers
                    </span>
                  </div>

                  {/* signature cards */}
                  <div className="mt-[2.4mm] grid grid-cols-2 gap-3">
                    <SignatureCard
                      title="Prepared by"
                      stamp="Company Stamp"
                    />
                    <SignatureCard
                      title={isMob ? 'Received by (Client / Site)' : 'Interviewed by (Client)'}
                      stamp={isMob ? 'Site Stamp' : 'Client Stamp'}
                    />
                  </div>
                </div>
              ) : null}
            </div>

            {/* footer strip — page X of Y */}
            <div
              className="pointer-events-none absolute inset-x-0 z-10 flex items-center justify-center"
              style={{ bottom: `${geo.bottomMm + 0.8}mm` }}
            >
              <p className="text-[6.5px] font-semibold tracking-[0.14em] uppercase" style={{ color: MUTED }}>
                Page {pageIdx + 1} of {totalPages}
                <span className="mx-1.5 opacity-50">|</span>
                <span lang="ar" dir="rtl" className="tracking-normal">
                  صفحة {pageIdx + 1} من {totalPages}
                </span>
              </p>
            </div>
          </div>
        )
      })}
    </>
  )
}

function InfoField({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="text-[6px] font-semibold uppercase tracking-[0.12em]" style={{ color: MUTED }}>
        {label}
      </p>
      <p
        className="mt-[0.5mm] truncate text-[8.5px] font-bold leading-snug"
        style={{ color: '#111827' }}
        title={value}
      >
        {value}
      </p>
    </div>
  )
}

// ── The workers table ────────────────────────────────────────────────────────

function SheetTable({
  list,
  cols,
  rowIdxs,
  th,
  rowFont,
  nameFont,
  isMob,
}: {
  list: NameListDetail
  cols: { key: NameListColumnKey; label: string }[]
  rowIdxs: number[]
  th: string
  rowFont: string
  nameFont: string
  isMob: boolean
}) {
  const widths = useMemo(() => {
    // # 7mm + name flexible + chosen columns
    const used = 7 + cols.reduce((s, c) => s + COL_W[c.key], 0)
    const nameW = Math.max(24, 194 - used) // 210 - 2*8 padding
    const total = 7 + nameW + cols.reduce((s, c) => s + COL_W[c.key], 0)
    const pct = (mm: number) => `${(mm / total) * 100}%`
    return {
      name: pct(nameW),
      cols: cols.map((c) => pct(COL_W[c.key])),
      num: pct(7),
    }
  }, [cols])

  const td = `${rowFont} px-1 py-[2.6px] align-middle leading-[1.25] text-neutral-900`
  const nameTd = `${nameFont} px-1 py-[2.6px] align-middle leading-[1.25] font-semibold text-neutral-900`

  return (
    <table className="w-full table-fixed border-collapse" style={{ tableLayout: 'fixed' }}>
      <thead style={{ display: 'table-header-group' }}>
        <tr>
          <th
            className={`${th} rounded-l-[8px]`}
            style={{ background: DARK_NAVY, width: widths.num }}
          >
            #
          </th>
          <th className={`${th} text-left`} style={{ background: DARK_NAVY, width: widths.name }}>
            Employee Name
          </th>
          {cols.map((c, i) => (
            <th
              key={c.key}
              className={`${th} ${i === cols.length - 1 ? 'rounded-r-[8px]' : ''} ${
                c.key === 'remarks' ? 'text-left' : ''
              }`}
              style={{ background: DARK_NAVY, width: widths.cols[i] }}
            >
              {c.key === 'experience' ? 'Exp. (yrs)' : c.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rowIdxs.map((idx) => {
          const w = list.workers[idx]
          return (
            <tr key={w.id} style={{ borderBottom: `1px solid ${ROW_SEP}` }}>
              <td className={`${td} text-center`}>
                <span
                  className="inline-flex h-[4.6mm] w-[4.6mm] items-center justify-center rounded-full text-[7.6px] font-bold"
                  style={{ border: `1.3px solid ${GOLD}`, color: NAVY }}
                >
                  {idx + 1}
                </span>
              </td>
              <td className={nameTd}>{w.staff.fullName}</td>
              {cols.map((c) => (
                <td key={c.key} className={td} style={c.key === 'remarks' ? {} : { textAlign: 'center' }}>
                  <CellContent colKey={c.key} w={w} isMob={isMob} />
                </td>
              ))}
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

function CellContent({
  colKey,
  w,
  isMob,
}: {
  colKey: NameListColumnKey
  w: NameListWorkerRow
  isMob: boolean
}) {
  switch (colKey) {
    case 'trade':
      return <>{w.staff.categoryName ?? w.staff.position ?? '—'}</>
    case 'experience':
      return <>{w.staff.experienceYears != null ? w.staff.experienceYears : '—'}</>
    case 'nationality':
      return <>{w.staff.nationality ?? '—'}</>
    case 'iqama':
      return <span className="tabular-nums">{w.staff.iqamaId}</span>
    case 'passport':
      return <span className="tabular-nums">{w.staff.passportNo ?? '—'}</span>
    case 'mobile':
      return <span className="tabular-nums">{formatSaudiMobile(w.staff.phone)}</span>
    case 'blood':
      return w.staff.bloodGroup ? (
        <span
          className="inline-block rounded-full px-1.5 py-[0.5px] text-[7.6px] font-bold"
          style={{ background: BLOOD_BG, color: BLOOD_FG }}
        >
          {w.staff.bloodGroup}
        </span>
      ) : (
        <>{'—'}</>
      )
    case 'iqamaExpiry':
      return <>{w.staff.iqamaExpiry ? nlFormatDate(w.staff.iqamaExpiry) : '—'}</>
    case 'employeeId':
      return <span className="tabular-nums">{w.staff.id}</span>
    case 'result':
      if (w.result) {
        const color =
          w.result === 'selected'
            ? '#047857'
            : w.result === 'rejected'
              ? '#BE123C'
              : w.result === 'absent'
                ? '#B45309'
                : '#6D28D9'
        return (
          <span className="text-[8.2px] font-bold uppercase" style={{ color }}>
            {w.result === 'onhold' ? 'On hold' : w.result}
          </span>
        )
      }
      // 3 empty tick boxes — the client ticks by hand
      return (
        <span className="inline-flex items-center gap-[3px] whitespace-nowrap text-[6.6px] text-neutral-700">
          <TickBox label="Selected" />
          <TickBox label="Rejected" />
          <TickBox label="Absent" />
        </span>
      )
    case 'remarks':
      return <span className="text-left">{w.remarks ?? ''}</span>
    default:
      return null
  }
}

function TickBox({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-[1.5px]">
      <span
        className="inline-block h-[2.6mm] w-[2.6mm] rounded-[1px]"
        style={{ border: '1px solid #9CA3AF', background: '#fff' }}
      />
      {label}
    </span>
  )
}

function SignatureCard({ title, stamp }: { title: string; stamp: string }) {
  return (
    <div
      className="rounded-md p-[2.6mm]"
      style={{ background: CREAM, border: `1px solid ${BORDER}` }}
    >
      <p
        className="flex items-center justify-center gap-[4px] text-[6.5px] font-bold uppercase tracking-[0.14em]"
        style={{ color: GOLD }}
      >
        <GoldDiamond size={3.5} />
        {title}
        <GoldDiamond size={3.5} />
      </p>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1 pt-[7mm]">
          <div className="w-3/4 border-b border-neutral-500 pb-[0.4mm]" />
          <p className="mt-[1.6mm] text-[7px] text-neutral-700">
            Name: <span className="ml-1 inline-block w-[22mm] border-b border-neutral-400 align-baseline" />
          </p>
          <p className="mt-[1.2mm] text-[7px] text-neutral-700">
            Date: <span className="ml-1 tracking-[0.08em]">__ / __ / ____</span>
          </p>
        </div>
        <div
          className="mt-[1.5mm] flex h-[19mm] w-[19mm] shrink-0 items-center justify-center rounded-full"
          style={{ border: `1.5px dashed ${GOLD}99` }}
        >
          <p className="text-center text-[6px] font-bold uppercase leading-snug" style={{ color: GOLD }}>
            {stamp}
          </p>
        </div>
      </div>
    </div>
  )
}
