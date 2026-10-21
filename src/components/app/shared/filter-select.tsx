'use client'

import { useState } from 'react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ChevronDown, Search, SlidersHorizontal, X } from 'lucide-react'
import { cn } from '@/lib/utils'

export type FilterOption = { value: string; label: string }

export function SearchInput({
  value,
  onChange,
  placeholder = 'Search...',
  className,
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  className?: string
}) {
  return (
    <div className={cn('relative', className)}>
      <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="h-9 pl-8 pr-8"
      />
      {value ? (
        <button
          type="button"
          onClick={() => onChange('')}
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded-sm p-0.5 text-muted-foreground hover:text-foreground"
          aria-label="Clear search"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      ) : null}
    </div>
  )
}

export function FilterSelect({
  value,
  onChange,
  options,
  placeholder,
  className,
  allowEmpty = true,
  emptyLabel = 'All',
}: {
  value: string
  onChange: (v: string) => void
  options: FilterOption[]
  placeholder: string
  className?: string
  allowEmpty?: boolean
  emptyLabel?: string
}) {
  return (
    <Select value={value || undefined} onValueChange={(v) => onChange(v ?? '')}>
      <SelectTrigger className={cn('h-9 w-full sm:w-[160px]', className)} aria-label={placeholder}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {allowEmpty ? (
          <SelectItem value="all">{emptyLabel}</SelectItem>
        ) : null}
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

/**
 * Responsive filter bar.
 *
 * Desktop (sm+): all controls flow in a single wrapping row — unchanged.
 * Mobile (<sm): the search input (when provided via `search`) plus a compact
 * "Filters" toggle stay visible; the remaining controls collapse behind the
 * toggle so the list content starts near the top of the viewport instead of
 * below a stack of dropdowns. `activeCount` renders a small badge so users
 * can see applied filters while collapsed.
 */
export function FilterBar({
  children,
  className,
  search,
  activeCount = 0,
}: {
  children: React.ReactNode
  className?: string
  /** Always-visible control (typically a SearchInput). Hidden on desktop? No — it flattens inline. */
  search?: React.ReactNode
  /** Number of non-default filter controls applied — shown as a badge on the mobile toggle. */
  activeCount?: number
}) {
  const [open, setOpen] = useState(false)
  return (
    <div
      className={cn('flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center', className)}
      data-filters-open={open ? '' : undefined}
    >
      {/* Mobile header row: search + toggle. On sm+ this wrapper disappears (display:contents)
          so the search control flows inline with the rest. */}
      <div className="flex w-full items-center gap-2 sm:contents">
        {search ? <div className="min-w-0 flex-1 sm:contents">{search}</div> : null}
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="h-9 shrink-0 gap-1.5 px-3 sm:hidden"
        >
          <SlidersHorizontal className="h-4 w-4" />
          <span className="hidden min-[360px]:inline">Filters</span>
          {activeCount > 0 ? (
            <span
              className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1 text-[11px] font-bold leading-none text-primary-foreground tabular-nums"
              aria-label={`${activeCount} filters applied`}
            >
              {activeCount}
            </span>
          ) : null}
          <ChevronDown
            className={cn('h-3.5 w-3.5 text-muted-foreground transition-transform', open && 'rotate-180')}
          />
        </Button>
      </div>
      {/* Filter controls: collapsed behind the toggle on mobile; inline (contents) on sm+ */}
      <div className={cn('flex-col gap-2 sm:contents', open ? 'flex' : 'hidden')}>
        {children}
      </div>
    </div>
  )
}
