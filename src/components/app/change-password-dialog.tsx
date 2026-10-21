'use client'

import { useEffect, useMemo, useState } from 'react'
import { Loader2, Lock, ShieldCheck } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { toast } from 'sonner'
import { api } from '@/lib/api-client'
import { cn } from '@/lib/utils'

type Field = 'current' | 'next' | 'confirm'

function strengthOf(pw: string): { score: 0 | 1 | 2 | 3; label: string } {
  if (!pw) return { score: 0, label: '' }
  let pts = 0
  if (pw.length >= 8) pts++
  if (pw.length >= 12) pts++
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) pts++
  if (/\d/.test(pw) || /[^A-Za-z0-9]/.test(pw)) pts++
  if (pts <= 1) return { score: 1, label: 'Weak' }
  if (pts === 2) return { score: 2, label: 'Fair' }
  return { score: 3, label: 'Strong' }
}

const STRENGTH_STYLES: Record<number, string> = {
  1: 'bg-rose-500',
  2: 'bg-amber-500',
  3: 'bg-emerald-600',
}

const STRENGTH_TEXT: Record<number, string> = {
  1: 'text-rose-600 dark:text-rose-400',
  2: 'text-amber-600 dark:text-amber-400',
  3: 'text-emerald-700 dark:text-emerald-400',
}

export function ChangePasswordDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [show, setShow] = useState<Record<Field, boolean>>({
    current: false,
    next: false,
    confirm: false,
  })
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const strength = useMemo(() => strengthOf(next), [next])

  // Reset the form whenever the dialog opens
  useEffect(() => {
    if (open) {
      setCurrent('')
      setNext('')
      setConfirm('')
      setShow({ current: false, next: false, confirm: false })
      setError(null)
      setSaving(false)
    }
  }, [open])

  const mismatch = confirm !== '' && next !== confirm

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (next.length < 8) {
      setError('New password must be at least 8 characters')
      return
    }
    if (next !== confirm) {
      setError('New passwords do not match')
      return
    }
    setSaving(true)
    try {
      await api.post('/api/auth/change-password', {
        currentPassword: current,
        newPassword: next,
      })
      toast.success('Password changed', {
        description: 'Use your new password the next time you sign in.',
      })
      onOpenChange(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to change password')
    } finally {
      setSaving(false)
    }
  }

  function renderToggle(field: Field) {
    return (
      <button
        type="button"
        tabIndex={-1}
        onClick={() => setShow((s) => ({ ...s, [field]: !s[field] }))}
        className="absolute inset-y-0 right-0 flex w-9 items-center justify-center text-muted-foreground transition-colors hover:text-foreground"
        aria-label={show[field] ? 'Hide password' : 'Show password'}
      >
        {show[field] ? (
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
            <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
            <path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" />
            <line x1="2" x2="22" y1="2" y2="22" />
          </svg>
        ) : (
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
        )}
      </button>
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Lock className="h-4 w-4 text-primary" />
            Change Password
          </DialogTitle>
          <DialogDescription>
            Choose a strong password — you&apos;ll stay signed in on this device.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="cp-current">Current password</Label>
            <div className="relative">
              <Input
                id="cp-current"
                type={show.current ? 'text' : 'password'}
                autoComplete="current-password"
                className="pr-10"
                value={current}
                onChange={(e) => setCurrent(e.target.value)}
                required
              />
              {renderToggle('current')}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="cp-next">New password</Label>
            <div className="relative">
              <Input
                id="cp-next"
                type={show.next ? 'text' : 'password'}
                autoComplete="new-password"
                className="pr-10"
                value={next}
                onChange={(e) => setNext(e.target.value)}
                required
                minLength={8}
                aria-describedby={next ? 'cp-strength' : undefined}
              />
              {renderToggle('next')}
            </div>
            {next ? (
              <div id="cp-strength" className="flex items-center gap-2" aria-live="polite">
                <div className="flex h-1.5 flex-1 gap-1 overflow-hidden rounded-full">
                  {[1, 2, 3].map((i) => (
                    <div
                      key={i}
                      className={cn(
                        'h-full flex-1 rounded-full bg-muted transition-colors',
                        i <= strength.score && STRENGTH_STYLES[strength.score]
                      )}
                    />
                  ))}
                </div>
                <span className={cn('w-14 text-right text-xs font-medium', STRENGTH_TEXT[strength.score])}>
                  {strength.label}
                </span>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">At least 8 characters; mix letters, numbers or symbols.</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="cp-confirm">Confirm new password</Label>
            <div className="relative">
              <Input
                id="cp-confirm"
                type={show.confirm ? 'text' : 'password'}
                autoComplete="new-password"
                className="pr-10"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                required
                aria-invalid={mismatch}
              />
              {renderToggle('confirm')}
            </div>
            {mismatch ? (
              <p className="text-xs text-destructive" role="alert">
                Passwords do not match
              </p>
            ) : null}
          </div>

          {error ? (
            <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}

          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving || mismatch || next.length < 8 || !current}>
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ShieldCheck className="mr-2 h-4 w-4" />}
              Update password
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
