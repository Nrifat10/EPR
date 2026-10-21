'use client'

import { ArrowUpRight } from 'lucide-react'
import { cn } from '@/lib/utils'

export function StatCard({
  title,
  value,
  icon: Icon,
  tone = 'navy',
  onMoreInfo,
  moreInfoLabel = 'More info',
  sublabel,
  valuePrefix,
}: {
  title: string
  value: string
  icon: React.ComponentType<{ className?: string }>
  tone?: 'navy' | 'gold' | 'green' | 'red' | 'amber' | 'violet' | 'teal'
  onMoreInfo?: () => void
  moreInfoLabel?: string
  sublabel?: string
  /** Small de-emphasized unit/prefix rendered before the value (e.g. "SAR") —
   *  visually unifies money cards with plain count cards */
  valuePrefix?: string
}) {
  const tones: Record<string, string> = {
    navy: 'bg-gradient-to-br from-[#1E3A66] to-[#0F1F3D] text-white',
    gold: 'bg-gradient-to-br from-[#E3C55C] to-[#C9A430] text-[#2A2005]',
    green: 'from-emerald-600 to-emerald-500 text-emerald-50',
    red: 'from-rose-600 to-rose-500 text-rose-50',
    amber: 'from-amber-500 to-amber-400 text-amber-50',
    violet: 'from-violet-600 to-violet-500 text-violet-50',
    teal: 'from-teal-600 to-teal-500 text-teal-50',
  }
  return (
    <div className="group relative overflow-hidden rounded-xl border bg-card shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md">
      <div className={cn('flex items-start justify-between gap-3 p-4 sm:p-5', onMoreInfo && 'pb-11 sm:pb-11')}>
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-muted-foreground" title={title}>
            {title}
          </p>
          <p
            className="mt-1.5 text-balance text-xl font-bold tabular-nums leading-tight tracking-tight break-words hyphens-none sm:text-2xl"
            title={valuePrefix ? `${valuePrefix} ${value}` : value}
          >
            {valuePrefix ? (
              <span className="mr-1.5 align-baseline text-sm font-semibold text-muted-foreground/80 sm:text-base">
                {valuePrefix}
              </span>
            ) : null}
            {value}
          </p>
          {sublabel ? <p className="mt-1 text-xs leading-snug text-muted-foreground">{sublabel}</p> : null}
        </div>
        <div
          className={cn(
            'flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br shadow-inner ring-1 ring-black/10 sm:h-11 sm:w-11',
            tones[tone]
          )}
        >
          <Icon className="h-5 w-5" />
        </div>
      </div>
      {onMoreInfo ? (
        <button
          type="button"
          onClick={onMoreInfo}
          className="absolute inset-x-0 bottom-0 flex w-full items-center justify-between border-t bg-muted/40 px-4 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/70 hover:text-foreground"
        >
          <span>{moreInfoLabel}</span>
          <ArrowUpRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
        </button>
      ) : null}
    </div>
  )
}
