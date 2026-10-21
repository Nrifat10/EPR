'use client'

import { cn } from '@/lib/utils'

export function PageHeader({
  title,
  description,
  children,
}: {
  title: string
  description?: string
  children?: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{title}</h1>
        {description ? (
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {children ? <div className="flex flex-wrap items-center gap-2">{children}</div> : null}
    </div>
  )
}

export function SectionCard({
  className,
  children,
}: {
  className?: string
  children: React.ReactNode
}) {
  return (
    <div className={cn('rounded-xl border bg-card text-card-foreground shadow-sm', className)}>
      {children}
    </div>
  )
}

/**
 * Floating action button for the primary "create" action on mobile (<md).
 * Duplicates the PageHeader button into the thumb zone so the action stays
 * reachable after scrolling. Icon-only under 420px, icon + label above.
 * Hidden on desktop and in print; inert while a modal dialog is open
 * (Radix sets pointer-events:none on <body>).
 */
export function MobileFab({
  label,
  onClick,
  icon: Icon,
}: {
  label: string
  onClick: () => void
  icon: React.ComponentType<{ className?: string }>
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={cn(
        'fixed bottom-[calc(1.25rem+env(safe-area-inset-bottom))] right-4 z-40',
        'inline-flex h-14 w-14 items-center justify-center gap-2 rounded-full',
        'bg-primary text-primary-foreground shadow-lg shadow-primary/30 ring-1 ring-primary/10',
        'transition-transform hover:scale-[1.04] active:scale-95',
        'min-[420px]:w-auto min-[420px]:px-5',
        'md:hidden print:hidden'
      )}
    >
      <Icon className="h-5 w-5 shrink-0" />
      <span className="hidden text-sm font-semibold min-[420px]:inline">{label}</span>
    </button>
  )
}
