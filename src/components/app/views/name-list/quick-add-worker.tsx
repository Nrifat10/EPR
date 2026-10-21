'use client'

// Quick-add worker — the boss types a new worker straight into a Name List
// (no detour to the Employees module). Creates the employee record and, when
// a listId is given, adds them to that list in the same request.
//
//   • Name + Trade are the essentials; everything else is optional.
//   • Blank Iqama → the server stores a TEMP-###### placeholder and we warn
//     the boss to update the real number later from the Employees module.
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { UserRoundPlus } from 'lucide-react'

import { api } from '@/lib/api-client'
import type { Paginated } from '@/lib/types'
import { formatSaudiMobile } from '@/lib/name-list-utils'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

export type QuickWorker = {
  id: string
  fullName: string
  iqamaId: string
  phone: string | null
  passportNo: string | null
  nationality: string | null
  bloodGroup: string | null
  experienceYears: number | null
  deploymentStatus: string
  staffCategory: { id: string; name: string } | null
}

type QuickAddResponse = {
  staff: QuickWorker
  addedToList: boolean
  listNo: string | null
  tempIqama: boolean
}

// Common workforce nationalities in Saudi manpower supply — merged with
// whatever already exists in the Employee database (passed by the caller).
const COMMON_NATIONALITIES = [
  'Indian',
  'Bangladeshi',
  'Pakistani',
  'Nepali',
  'Filipino',
  'Egyptian',
  'Sri Lankan',
  'Sudanese',
  'Yemeni',
  'Ethiopian',
  'Kenyan',
  'Indonesian',
  'Vietnamese',
  'Thai',
  'Turkish',
  'Syrian',
  'Jordanian',
  'Ghanaian',
  'Nigerian',
  'Ugandan',
  'Tanzanian',
  'Moroccan',
]

const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-']

const EMPTY_FORM = {
  fullName: '',
  staffCategoryId: '',
  iqamaId: '',
  passportNo: '',
  phone: '',
  nationality: '',
  bloodGroup: '',
  experienceYears: '',
}

export function QuickAddWorkerDialog({
  open,
  onOpenChange,
  listId,
  categories: categoriesProp,
  nationalities = [],
  onSaved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** when set, the new worker is added to this list in the same request */
  listId?: string | null
  /** trades — fetched internally when omitted */
  categories?: { id: string; name: string }[]
  nationalities?: string[]
  onSaved: (staff: QuickWorker, info: { addedToList: boolean; tempIqama: boolean; listNo: string | null }) => void | Promise<void>
}) {
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [categories, setCategories] = useState<{ id: string; name: string }[]>([])

  useEffect(() => {
    if (open) setForm(EMPTY_FORM)
  }, [open])

  // trades — use the passed list (picker already has it) or fetch once
  useEffect(() => {
    if (!open) return
    if (categoriesProp && categoriesProp.length > 0) {
      setCategories(categoriesProp)
      return
    }
    api
      .get<Paginated<{ id: string; name: string }>>('/api/staff-categories?page=1&pageSize=50')
      .then((r) => setCategories(r.data))
      .catch(() => setCategories([]))
  }, [open, categoriesProp])

  const natOptions = Array.from(new Set([...nationalities, ...COMMON_NATIONALITIES])).sort()

  async function handleSave() {
    if (!form.fullName.trim()) {
      toast.error('Worker name is required')
      return
    }
    setSaving(true)
    try {
      const res = await api.post<QuickAddResponse>('/api/name-lists/quick-worker', {
        fullName: form.fullName,
        staffCategoryId: form.staffCategoryId || null,
        iqamaId: form.iqamaId || null,
        passportNo: form.passportNo || null,
        phone: form.phone || null,
        nationality: form.nationality || null,
        bloodGroup: form.bloodGroup || null,
        experienceYears: form.experienceYears === '' ? null : Number(form.experienceYears),
        listId: listId ?? null,
      })
      if (res.tempIqama) {
        toast.warning(
          `${res.staff.fullName} added with temporary Iqama ${res.staff.iqamaId} — update the real number later from Employees.`
        )
      }
      if (res.addedToList) {
        toast.success(`${res.staff.fullName} added to ${res.listNo}`)
      } else {
        toast.success(`${res.staff.fullName} created — selected for the list`)
      }
      onOpenChange(false)
      await onSaved(res.staff, { addedToList: res.addedToList, tempIqama: res.tempIqama, listNo: res.listNo })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to add worker')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserRoundPlus className="h-5 w-5" /> Add new worker directly
          </DialogTitle>
          <DialogDescription>
            {listId
              ? 'Creates a new employee record and adds them to this list right away.'
              : 'Creates a new employee record and selects them for this list.'}{' '}
            Only the name is required — fill the rest now or later from the Employees module.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="grid gap-1.5 sm:col-span-2">
            <Label htmlFor="qa-name">
              Full Name <span className="text-destructive">*</span>
            </Label>
            <Input
              id="qa-name"
              autoFocus
              value={form.fullName}
              onChange={(e) => setForm((f) => ({ ...f, fullName: e.target.value }))}
              placeholder="e.g. Mohammad Anwar Hossain"
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  void handleSave()
                }
              }}
            />
          </div>

          <div className="grid gap-1.5">
            <Label>Trade</Label>
            <Select
              value={form.staffCategoryId || 'none'}
              onValueChange={(v) => setForm((f) => ({ ...f, staffCategoryId: v === 'none' ? '' : v }))}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select trade" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">— None —</SelectItem>
                {categories.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="qa-iqama">Iqama No.</Label>
            <Input
              id="qa-iqama"
              value={form.iqamaId}
              onChange={(e) => setForm((f) => ({ ...f, iqamaId: e.target.value }))}
              placeholder="2XXXXXXXXX"
              className="font-mono"
            />
            <p className="text-[11px] text-muted-foreground">
              Blank → temporary ID (update later from Employees).
            </p>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="qa-passport">Passport No.</Label>
            <Input
              id="qa-passport"
              value={form.passportNo}
              onChange={(e) => setForm((f) => ({ ...f, passportNo: e.target.value }))}
              className="font-mono"
            />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="qa-phone">Mobile No.</Label>
            <Input
              id="qa-phone"
              value={form.phone}
              onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
              placeholder="05X XXX XXXX"
              className="font-mono"
            />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="qa-nat">Nationality</Label>
            <Input
              id="qa-nat"
              list="qa-nat-options"
              value={form.nationality}
              onChange={(e) => setForm((f) => ({ ...f, nationality: e.target.value }))}
              placeholder="e.g. Bangladeshi"
            />
            <datalist id="qa-nat-options">
              {natOptions.map((n) => (
                <option key={n} value={n} />
              ))}
            </datalist>
          </div>

          <div className="grid gap-1.5">
            <Label>Blood Group</Label>
            <Select
              value={form.bloodGroup || 'none'}
              onValueChange={(v) => setForm((f) => ({ ...f, bloodGroup: v === 'none' ? '' : v }))}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">— Not set —</SelectItem>
                {BLOOD_GROUPS.map((b) => (
                  <SelectItem key={b} value={b}>
                    {b}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-1.5 sm:col-span-2">
            <Label htmlFor="qa-exp">Experience (years)</Label>
            <Input
              id="qa-exp"
              type="number"
              min={0}
              max={60}
              value={form.experienceYears}
              onChange={(e) => setForm((f) => ({ ...f, experienceYears: e.target.value }))}
              placeholder="e.g. 5"
              className="sm:max-w-[160px]"
            />
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <p className="mr-auto hidden text-xs text-muted-foreground sm:block">
            Prints as {formatSaudiMobile(form.phone) || '05X XXX XXXX'} · shows ⚠ until Mobile /
            Passport / Blood are filled
          </p>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving || !form.fullName.trim()}>
            <UserRoundPlus className="h-4 w-4" />
            {saving ? 'Adding…' : listId ? 'Add to list' : 'Create worker'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
