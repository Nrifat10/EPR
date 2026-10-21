// Name List module shared helpers — client & server safe (no server-only imports).
import type {
  NameListColumnKey,
  NameListColumns,
  NameListSubjectKind,
  NameListStatus,
  NameListWorkerResult,
} from '@/lib/types'

// ── Subject colours & kinds ─────────────────────────────────────────────────
export const NL_SUBJECT_FALLBACK_COLOR = '#6B7488'

export const NL_STATUS_META: Record<NameListStatus, { label: string; chip: string }> = {
  draft: { label: 'Draft', chip: 'border-neutral-300 bg-neutral-100 text-neutral-700' },
  sent: {
    label: 'Sent',
    chip: 'border-sky-300 bg-sky-50 text-sky-700 dark:border-sky-500/40 dark:bg-sky-500/10 dark:text-sky-300',
  },
  completed: {
    label: 'Completed',
    chip: 'border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-500/40 dark:bg-emerald-500/10 dark:text-emerald-300',
  },
  cancelled: {
    label: 'Cancelled',
    chip: 'border-neutral-300 bg-neutral-50 text-neutral-500 line-clamp-1 dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-400',
  },
}

export const NL_RESULT_META: Record<NameListWorkerResult, { label: string; chip: string; dot: string }> = {
  selected: {
    label: 'Selected',
    chip: 'border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-500/40 dark:bg-emerald-500/10 dark:text-emerald-300',
    dot: 'bg-emerald-500',
  },
  rejected: {
    label: 'Rejected',
    chip: 'border-rose-300 bg-rose-50 text-rose-700 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-300',
    dot: 'bg-rose-500',
  },
  absent: {
    label: 'Absent',
    chip: 'border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-300',
    dot: 'bg-amber-500',
  },
  onhold: {
    label: 'On hold',
    chip: 'border-violet-300 bg-violet-50 text-violet-700 dark:border-violet-500/40 dark:bg-violet-500/10 dark:text-violet-300',
    dot: 'bg-violet-500',
  },
}

export const NL_DEPLOYMENT_META: Record<string, { label: string; chip: string }> = {
  available: { label: 'Available', chip: 'border-emerald-300 bg-emerald-50 text-emerald-700' },
  in_interview: { label: 'In Interview', chip: 'border-sky-300 bg-sky-50 text-sky-700' },
  selected: { label: 'Selected', chip: 'border-violet-300 bg-violet-50 text-violet-700' },
  deployed: { label: 'Deployed', chip: 'border-navy/25 bg-navy/8 text-primary' },
}

// ── Formatting ───────────────────────────────────────────────────────────────

/** Saudi mobile display format: "05X XXX XXXX". Other formats pass through. */
export function formatSaudiMobile(v?: string | null): string {
  if (!v) return '—'
  const d = v.replace(/\D/g, '')
  if (/^05\d{8}$/.test(d)) return `${d.slice(0, 3)} ${d.slice(3, 6)} ${d.slice(6)}`
  if (/^9665\d{8}$/.test(d)) return `0${d.slice(3, 5)} ${d.slice(5, 8)} ${d.slice(8)}`
  return v
}

/** DD / MM / YYYY (the template's spaced-slash date style). */
export function nlFormatDate(d: string | Date | null | undefined): string {
  if (!d) return '—'
  const dt = typeof d === 'string' ? new Date(d) : d
  if (Number.isNaN(dt.getTime())) return '—'
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(dt.getDate())} / ${p(dt.getMonth() + 1)} / ${dt.getFullYear()}`
}

/** List date → YYYY-MM-DD input value (local, no TZ drift). */
export function nlDateInput(d: string | Date | null | undefined): string {
  if (!d) return ''
  const dt = typeof d === 'string' ? new Date(d) : d
  if (Number.isNaN(dt.getTime())) return ''
  const p = (n: number) => String(n).padStart(2, '0')
  return `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())}`
}

// ── Column settings ──────────────────────────────────────────────────────────

export const NL_ALL_COLUMNS: { key: NameListColumnKey; label: string }[] = [
  { key: 'trade', label: 'Trade' },
  { key: 'experience', label: 'Experience' },
  { key: 'nationality', label: 'Nationality' },
  { key: 'iqama', label: 'Iqama No.' },
  { key: 'passport', label: 'Passport No.' },
  { key: 'mobile', label: 'Mobile No.' },
  { key: 'blood', label: 'Blood Group' },
  { key: 'iqamaExpiry', label: 'Iqama Expiry' },
  { key: 'employeeId', label: 'Employee ID' },
  { key: 'result', label: 'Result' },
  { key: 'remarks', label: 'Remarks' },
]

/** Column order per template kind — mirrors the two design images. */
export const NL_KIND_COLUMN_ORDER: Record<'interview' | 'mobilization', NameListColumnKey[]> = {
  // # · Name · Trade · Exp · Nationality · Iqama · Mobile · Result · Remarks
  interview: ['trade', 'experience', 'nationality', 'iqama', 'mobile', 'result', 'remarks'],
  // # · Name · Iqama · Passport · Mobile · Nationality · Trade · Blood · Remarks
  mobilization: ['iqama', 'passport', 'mobile', 'nationality', 'trade', 'blood', 'remarks'],
}

/** Ordered visible columns for a list (print + Excel share this). */
export function nlOrderedColumns(
  kind: 'interview' | 'mobilization',
  cols: NameListColumns
): { key: NameListColumnKey; label: string }[] {
  const order = NL_KIND_COLUMN_ORDER[kind]
  const extra = (['iqamaExpiry', 'employeeId'] as NameListColumnKey[]).filter(
    (k) => !order.includes(k)
  )
  return [...order, ...extra]
    .filter((key) => cols[key] === true)
    .map((key) => ({ key, label: NL_ALL_COLUMNS.find((c) => c.key === key)?.label ?? key }))
}

/** Default visible columns per template kind (mirrors the two design images). */
export function defaultColumnsFor(kind: NameListSubjectKind): NameListColumns {
  if (kind === 'mobilization') {
    return {
      iqama: true,
      passport: true,
      mobile: true,
      nationality: true,
      trade: true,
      blood: true,
      remarks: true,
    }
  }
  return {
    trade: true,
    experience: true,
    nationality: true,
    iqama: true,
    mobile: true,
    result: true,
    remarks: true,
  }
}

const LS_PREFIX = 'namelist.columns.v1.'

/** Per-subject remembered defaults (localStorage, user's own browser). */
export function rememberColumnDefaults(kind: NameListSubjectKind, cols: NameListColumns): void {
  try {
    localStorage.setItem(LS_PREFIX + kind, JSON.stringify(cols))
  } catch {
    // private mode etc. — remembering is best-effort only
  }
}

export function readColumnDefaults(kind: NameListSubjectKind): NameListColumns | null {
  try {
    const raw = localStorage.getItem(LS_PREFIX + kind)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? (parsed as NameListColumns) : null
  } catch {
    return null
  }
}

/** Parse the JSON column snapshot stored on a list (server-safe). */
export function parseListColumns(raw: string | null | undefined): NameListColumns | null {
  if (!raw) return null
  try {
    const v = JSON.parse(raw)
    return v && typeof v === 'object' ? (v as NameListColumns) : null
  } catch {
    return null
  }
}

/** Visible column list for a list (snapshot → per-subject default → kind default).
 *  Client-side only (reads localStorage); server exports use the kind default. */
export function effectiveColumns(
  kind: NameListSubjectKind,
  snapshot: NameListColumns | null
): NameListColumns {
  if (snapshot) return snapshot
  return readColumnDefaults(kind) ?? defaultColumnsFor(kind)
}

/** Server-safe resolution (no localStorage): snapshot → kind default. */
export function effectiveColumnsServer(
  kind: NameListSubjectKind,
  snapshot: NameListColumns | null
): NameListColumns {
  return snapshot ?? defaultColumnsFor(kind)
}

/** Rough font tier: more visible columns → slightly smaller print font.
 *  (Boss asked for bigger print text — tiers were raised ~0.6–0.8px.) */
export function printFontTier(visibleCount: number): string {
  if (visibleCount >= 9) return 'text-[7.4px]'
  if (visibleCount >= 7) return 'text-[8.2px]'
  return 'text-[9.2px]'
}

/** Employee Name column prints one step larger — names must read easily. */
export function printNameFontTier(visibleCount: number): string {
  if (visibleCount >= 9) return 'text-[8px]'
  if (visibleCount >= 7) return 'text-[8.8px]'
  return 'text-[10px]'
}
