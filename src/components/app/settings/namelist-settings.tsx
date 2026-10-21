'use client'

// Settings → Name List section: subject manager (the 5 system subjects are
// fixed; Admin can add custom subjects with a badge colour and template kind,
// rename/recolor them, or delete custom ones that are not in use).
import { useCallback, useEffect, useState } from 'react'
import { ClipboardList, Loader2, Lock, Palette, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { SectionCard } from '@/components/app/shared/page-header'
import { api } from '@/lib/api-client'
import { useAppStore } from '@/lib/store'
import type { NameListSubjectRow } from '@/lib/types'

const PRESET_COLORS = [
  '#2F6FB0', // interview blue
  '#2E7D5B', // mobilization green
  '#C98A1B', // trade test amber
  '#132A4A', // medical navy
  '#6B7488', // demobilization grey
  '#7C3AED',
  '#BE123C',
  '#0E7490',
]

export function NameListSettingsSection() {
  const user = useAppStore((s) => s.user)
  const isAdmin =
    (user?.role?.name ?? '').toLowerCase() === 'admin' ||
    (user?.role?.name ?? '').toLowerCase() === 'super admin'

  const [subjects, setSubjects] = useState<NameListSubjectRow[] | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const [form, setForm] = useState({ name: '', color: PRESET_COLORS[0], kind: 'interview' })
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      setSubjects(await api.get<NameListSubjectRow[]>('/api/name-list-subjects'))
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to load subjects')
      setSubjects([])
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function addSubject() {
    if (!form.name.trim()) return toast.error('Name is required')
    setBusy(true)
    try {
      await api.post('/api/name-list-subjects', {
        name: form.name.trim(),
        color: form.color,
        kind: form.kind,
      })
      toast.success(`Subject "${form.name.trim()}" added`)
      setAddOpen(false)
      setForm({ name: '', color: PRESET_COLORS[0], kind: 'interview' })
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to add subject')
    } finally {
      setBusy(false)
    }
  }

  async function updateColor(s: NameListSubjectRow, color: string) {
    try {
      await api.put(`/api/name-list-subjects/${s.id}`, { color })
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to update colour')
    }
  }

  async function removeSubject(s: NameListSubjectRow) {
    setBusy(true)
    try {
      await api.del(`/api/name-list-subjects/${s.id}`)
      toast.success(`Subject "${s.name}" deleted`)
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to delete subject')
    } finally {
      setBusy(false)
    }
  }

  return (
    <SectionCard className="p-6">
      <h2 className="flex items-center gap-2 text-base font-semibold">
        <ClipboardList className="h-4 w-4" /> Name List
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Subjects (purposes) for worker name lists. The five system subjects are fixed — Admin can
        add more here. Column visibility is set per list in the print dialog (&ldquo;Remember as my
        default&rdquo; stores it per subject type).
      </p>

      {subjects === null ? (
        <div className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading subjects…
        </div>
      ) : (
        <div className="mt-4 space-y-2">
          {subjects.map((s) => (
            <div
              key={s.id}
              className="flex flex-wrap items-center gap-3 rounded-lg border px-3 py-2"
            >
              <span
                className="rounded-full px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-white"
                style={{ background: s.color }}
              >
                {s.name}
              </span>
              <Badge variant="outline" className="text-[10px]">
                {s.kind === 'interview' ? 'Interview workflow' : 'Mobilization workflow'}
              </Badge>
              {s.isSystem ? (
                <Badge variant="outline" className="gap-1 text-[10px] text-muted-foreground">
                  <Lock className="h-3 w-3" /> system
                </Badge>
              ) : null}
              <div className="ml-auto flex items-center gap-2">
                {isAdmin ? (
                  <span className="flex items-center gap-1" title="Badge colour">
                    <Palette className="h-3.5 w-3.5 text-muted-foreground" />
                    {PRESET_COLORS.map((c) => (
                      <button
                        key={c}
                        className={`h-4 w-4 rounded-full border transition-transform hover:scale-110 ${
                          s.color.toLowerCase() === c.toLowerCase() ? 'ring-2 ring-primary ring-offset-1' : ''
                        }`}
                        style={{ background: c }}
                        onClick={() => updateColor(s, c)}
                        aria-label={`Set ${s.name} colour to ${c}`}
                        disabled={busy}
                      />
                    ))}
                  </span>
                ) : null}
                {!s.isSystem && isAdmin ? (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-muted-foreground hover:text-destructive"
                    onClick={() => removeSubject(s)}
                    disabled={busy}
                    title="Delete subject"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      )}

      {isAdmin ? (
        <Button variant="outline" size="sm" className="mt-4" onClick={() => setAddOpen(true)}>
          <Plus className="h-4 w-4" /> Add subject
        </Button>
      ) : (
        <p className="mt-3 text-xs text-muted-foreground">Only Admin can manage subjects.</p>
      )}

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Add Name List subject</DialogTitle>
            <DialogDescription>
              Custom subjects reuse one of the two print templates and workflows.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-1.5">
              <Label>Name</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="e.g. Safety Induction"
              />
            </div>
            <div className="grid gap-1.5">
              <Label>Workflow / template</Label>
              <Select value={form.kind} onValueChange={(v) => setForm((f) => ({ ...f, kind: v }))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="interview">
                    Interview — results (Selected / Rejected…), tick-box print
                  </SelectItem>
                  <SelectItem value="mobilization">
                    Mobilization — site assignment, passport &amp; blood print
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label>Badge colour</Label>
              <div className="flex flex-wrap gap-1.5">
                {PRESET_COLORS.map((c) => (
                  <button
                    key={c}
                    className={`h-6 w-6 rounded-full border transition-transform hover:scale-110 ${
                      form.color === c ? 'ring-2 ring-primary ring-offset-2' : ''
                    }`}
                    style={{ background: c }}
                    onClick={() => setForm((f) => ({ ...f, color: c }))}
                    aria-label={`Colour ${c}`}
                  />
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>
              Cancel
            </Button>
            <Button onClick={addSubject} disabled={busy}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Add subject
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SectionCard>
  )
}
