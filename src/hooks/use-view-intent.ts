'use client'

import { useEffect } from 'react'
import { useAppStore } from '@/lib/store'
import type { ViewIntentPayload } from '@/lib/store'
import type { ViewKey } from '@/lib/types'

/**
 * One-shot view intent: returns `true` when a pending intent matches this view
 * (e.g. the command palette asked to deep-open the create dialog or the print
 * preview). The intent is consumed automatically right after the matching render.
 *
 * Works both when the target view mounts after navigation AND when the user is
 * already on the view (subscribes to intent changes).
 *
 * Usage:
 *   const shouldOpenCreate = useViewIntent('payroll', 'create')
 *   useEffect(() => { if (shouldOpenCreate) openCreate() }, [shouldOpenCreate])
 */
export function useViewIntent(
  view: ViewKey,
  kind: 'create' | 'print' = 'create'
): boolean {
  const intent = useAppStore((s) => s.pendingIntent)
  const matched = intent !== null && intent.view === view && intent.kind === kind

  // Consume the one-shot intent right after the matching render so it never
  // re-fires on later mounts. (External store update — event-driven, safe.)
  useEffect(() => {
    if (matched) {
      useAppStore.getState().consumePendingIntent(view, kind)
    }
  }, [matched, view, kind])

  return matched
}

/**
 * Record-scoped variant of {@link useViewIntent}: returns the target record id
 * when a 'record' intent (palette search → open a specific staff/project) is
 * pending for this view. The intent is consumed automatically.
 *
 * Usage:
 *   const record = useViewRecordIntent('staff-list')
 *   useEffect(() => {
 *     if (record.matched && record.recordId) openProfile(record.recordId)
 *   }, [record.matched])
 */
export function useViewRecordIntent(view: ViewKey): {
  matched: boolean
  recordId: string | null
  payload: ViewIntentPayload | null
} {
  const intent = useAppStore((s) => s.pendingIntent)
  const matched = intent !== null && intent.view === view && intent.kind === 'record'
  const recordId = matched && intent ? intent.recordId ?? null : null
  const payload = matched && intent ? intent.payload ?? null : null

  useEffect(() => {
    if (matched) {
      useAppStore.getState().consumePendingIntent(view, 'record')
    }
  }, [matched, view])

  return { matched, recordId, payload }
}
