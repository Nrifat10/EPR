'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Command, CornerDownLeft } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { can, useAppStore } from '@/lib/store'
import type { ViewKey } from '@/lib/types'

/** g-prefixed navigation targets (permission-aware) */
const GO_SHORTCUTS: { key: string; view: ViewKey; label: string; perm: string }[] = [
  { key: 'd', view: 'dashboard', label: 'Dashboard', perm: 'dashboard.view' },
  { key: 'p', view: 'projects', label: 'Project Management', perm: 'projects.view' },
  { key: 's', view: 'staff-list', label: 'Staff List', perm: 'staff.view' },
  { key: 'a', view: 'attendance', label: 'Staff Attendance', perm: 'attendance.view' },
  { key: 'w', view: 'payroll', label: 'Payroll', perm: 'payroll.view' },
  { key: 't', view: 'salary-sheet', label: 'Salary Sheet', perm: 'payroll.view' },
  { key: 'i', view: 'income-list', label: 'Income List', perm: 'accounts.view' },
  { key: 'e', view: 'expense-list', label: 'Expense List', perm: 'accounts.view' },
  { key: 'v', view: 'vat-return-expense', label: 'VAT Return Expense', perm: 'vat.view' },
  { key: 'r', view: 'accounts-summary', label: 'Accounts Summary', perm: 'accounts.view' },
]

const GO_TIMEOUT_MS = 1500

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="pointer-events-none inline-flex h-6 min-w-6 select-none items-center justify-center rounded border bg-muted px-1.5 font-mono text-[11px] font-semibold text-muted-foreground shadow-[inset_0_-1px_0_0_rgba(0,0,0,0.08)]">
      {children}
    </kbd>
  )
}

function ShortcutRow({ keys, label }: { keys: React.ReactNode; label: string }) {
  return (
    <li className="flex items-center justify-between gap-4 py-1.5">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="flex shrink-0 items-center gap-1">{keys}</span>
    </li>
  )
}

/** True when a key event happened inside a text-entry surface */
function isTypingTarget(e: KeyboardEvent): boolean {
  const el = e.target as HTMLElement | null
  if (!el) return false
  const tag = el.tagName
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    el.isContentEditable === true
  )
}

/** True while any overlay dialog is open (Radix renders [role=dialog]) */
function anyDialogOpen(): boolean {
  return document.querySelector('[role="dialog"]') !== null
}

/**
 * Keyboard shortcuts: `?` opens a cheat-sheet dialog, `g` then a key jumps to
 * a view (Gmail-style). Supports controlled usage (topbar button) and mounts
 * exactly ONCE — the topbar — so the global listener is not duplicated.
 */
export function ShortcutsDialog({
  open: controlledOpen,
  onOpenChange,
}: {
  open?: boolean
  onOpenChange?: (open: boolean) => void
} = {}) {
  const { user, setView } = useAppStore()
  const [internalOpen, setInternalOpen] = useState(false)
  const open = controlledOpen ?? internalOpen
  const setOpen = useCallback(
    (v: boolean) => {
      if (onOpenChange) onOpenChange(v)
      else setInternalOpen(v)
    },
    [onOpenChange]
  )
  const goArmedRef = useRef<{ timer: ReturnType<typeof setTimeout> | null }>({ timer: null })
  const [, forceTick] = useState(0)

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      // Ignore modifier combos and anything typed into form fields
      if (e.ctrlKey || e.metaKey || e.altKey || isTypingTarget(e)) return
      // Don't hijack keys while any dialog/palette is open
      if (anyDialogOpen()) return

      // "?" opens this cheat sheet (Shift + / on most layouts)
      if (e.key === '?' || (e.shiftKey && e.key === '/')) {
        e.preventDefault()
        setOpen(true)
        return
      }

      // g-prefixed navigation: press "g", then a target key within 1.5s
      if (e.key.toLowerCase() === 'g' && !e.shiftKey) {
        if (goArmedRef.current.timer) clearTimeout(goArmedRef.current.timer)
        goArmedRef.current.timer = setTimeout(() => {
          goArmedRef.current.timer = null
          forceTick((t) => t + 1)
        }, GO_TIMEOUT_MS)
        forceTick((t) => t + 1)
        return
      }

      if (goArmedRef.current.timer) {
        const target = GO_SHORTCUTS.find((s) => s.key === e.key.toLowerCase())
        clearTimeout(goArmedRef.current.timer)
        goArmedRef.current.timer = null
        forceTick((t) => t + 1)
        if (target && can(user, target.perm)) {
          e.preventDefault()
          setView(target.view)
        }
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      if (goArmedRef.current.timer) clearTimeout(goArmedRef.current.timer)
    }
  }, [user, setView, setOpen])

  const visibleGo = GO_SHORTCUTS.filter((s) => can(user, s.perm))

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Command className="h-4 w-4 text-primary" />
            Keyboard Shortcuts
          </DialogTitle>
          <DialogDescription>
            Work faster — shortcuts work anywhere outside text fields.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <section>
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Global
            </h3>
            <ul className="divide-y">
              <ShortcutRow
                label="Toggle command palette"
                keys={
                  <>
                    <Kbd>Ctrl</Kbd>
                    <Kbd>K</Kbd>
                  </>
                }
              />
              <ShortcutRow
                label="Show this shortcut sheet"
                keys={<Kbd>?</Kbd>}
              />
              <ShortcutRow
                label="Close dialogs and menus"
                keys={<Kbd>Esc</Kbd>}
              />
            </ul>
          </section>

          <section>
            <h3 className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Go to
              <span className="font-normal normal-case tracking-normal">
                (press <Kbd>G</Kbd>, release, then the key)
              </span>
            </h3>
            <ul className="grid grid-cols-1 gap-x-6 divide-y sm:grid-cols-2 sm:divide-y-0">
              {visibleGo.map((s) => (
                <li key={s.key} className="flex items-center justify-between gap-3 py-1.5">
                  <span className="truncate text-sm text-muted-foreground">{s.label}</span>
                  <span className="flex shrink-0 items-center gap-1">
                    <Kbd>G</Kbd>
                    <CornerDownLeft className="h-3 w-3 text-muted-foreground/60" />
                    <Kbd>{s.key.toUpperCase()}</Kbd>
                  </span>
                </li>
              ))}
            </ul>
          </section>

          <p className="rounded-lg border border-dashed bg-muted/30 p-2.5 text-center text-xs text-muted-foreground">
            Tip: the command palette (<Kbd>Ctrl</Kbd> <Kbd>K</Kbd>) can also create records,
            print the salary sheet and jump anywhere by name.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  )
}
