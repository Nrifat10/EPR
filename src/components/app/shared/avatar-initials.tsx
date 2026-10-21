'use client'

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { cn } from '@/lib/utils'
import { initials } from '@/lib/format'

const PALETTE = [
  'bg-gold-soft text-accent-foreground',
  'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300',
  'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300',
  'bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300',
  'bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300',
  'bg-teal-100 text-teal-700 dark:bg-teal-950 dark:text-teal-300',
]

function hashStr(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0
  return Math.abs(h)
}

export function AvatarInitials({
  name,
  src,
  className,
  size = 'default',
}: {
  name: string | null | undefined
  src?: string | null
  className?: string
  size?: 'sm' | 'default' | 'lg'
}) {
  const sizes = {
    sm: 'h-6 w-6 text-[10px]',
    default: 'h-9 w-9 text-xs',
    lg: 'h-12 w-12 text-sm',
  }
  if (src) {
    return (
      <Avatar className={cn(sizes[size], className)}>
        <AvatarImage src={src} alt={name ?? 'avatar'} />
        <AvatarFallback>{initials(name)}</AvatarFallback>
      </Avatar>
    )
  }
  return (
    <Avatar className={cn(sizes[size], className)}>
      <AvatarFallback
        className={cn('font-semibold', PALETTE[hashStr(name ?? '?') % PALETTE.length])}
      >
        {initials(name)}
      </AvatarFallback>
    </Avatar>
  )
}
