'use client'

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Loader2, Pencil, Plus, Tag, Tags, Users } from 'lucide-react'
import { api } from '@/lib/api-client'
import { can, useAppStore } from '@/lib/store'
import type { StaffCategory } from '@/lib/types'
import { PageHeader, SectionCard } from '@/components/app/shared/page-header'
import { ConfirmDelete } from '@/components/app/shared/confirm-delete'
import { EmptyState, TableSkeleton } from '@/components/app/shared/empty-state'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

export function StaffCategoriesView() {
  const { user } = useAppStore()

  const [categories, setCategories] = useState<StaffCategory[]>([])
  const [loading, setLoading] = useState(true)

  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<StaffCategory | null>(null)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await api.get<{ data: StaffCategory[] }>('/api/staff-categories')
      setCategories(res.data)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to load staff categories')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  function openCreate() {
    setEditing(null)
    setName('')
    setDescription('')
    setFormOpen(true)
  }

  function openEdit(category: StaffCategory) {
    setEditing(category)
    setName(category.name)
    setDescription(category.description ?? '')
    setFormOpen(true)
  }

  async function handleSubmit() {
    if (!name.trim()) {
      toast.error('Category name is required')
      return
    }
    setSaving(true)
    try {
      const payload = { name: name.trim(), description: description.trim() || null }
      if (editing) {
        await api.put(`/api/staff-categories/${editing.id}`, payload)
        toast.success('Category updated')
      } else {
        await api.post('/api/staff-categories', payload)
        toast.success('Category created')
      }
      setFormOpen(false)
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to save category')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(category: StaffCategory) {
    try {
      await api.del(`/api/staff-categories/${category.id}`)
      toast.success('Category deleted')
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to delete category')
    }
  }

  const canCreate = can(user, 'staff.create')
  const canEdit = can(user, 'staff.edit')
  const canDelete = can(user, 'staff.delete')

  return (
    <div className="space-y-4 sm:space-y-6">
      <PageHeader
        title="Staff Categories"
        description="Group staff by trade, skill or job category"
      >
        {canCreate ? (
          <Button onClick={openCreate}>
            <Plus className="h-4 w-4" />
            Add Category
          </Button>
        ) : null}
      </PageHeader>

      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <SectionCard key={i} className="p-5">
              <TableSkeleton rows={2} cols={2} />
            </SectionCard>
          ))}
        </div>
      ) : categories.length === 0 ? (
        <SectionCard>
          <EmptyState
            icon={Tags}
            title="No categories yet"
            description="Create staff categories such as Pipe Fitter or Welder to organize your workforce."
            action={
              canCreate ? (
                <Button onClick={openCreate}>
                  <Plus className="h-4 w-4" />
                  Add Category
                </Button>
              ) : null
            }
          />
        </SectionCard>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {categories.map((category) => (
            <SectionCard key={category.id} className="flex flex-col gap-3 p-5">
              <div className="flex items-start justify-between gap-2">
                <div className="flex min-w-0 items-center gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <Tag className="h-4 w-4" />
                  </div>
                  <p className="truncate text-sm font-semibold uppercase tracking-wide">
                    {category.name}
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  {canEdit ? (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-muted-foreground hover:text-foreground"
                      onClick={() => openEdit(category)}
                      aria-label={`Edit ${category.name}`}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                  ) : null}
                  {canDelete ? (
                    <ConfirmDelete
                      title={`Delete ${category.name}?`}
                      description="Staff assigned to this category will become uncategorized."
                      onConfirm={() => handleDelete(category)}
                    />
                  ) : null}
                </div>
              </div>
              {category.description ? (
                <p className="text-sm text-muted-foreground">{category.description}</p>
              ) : (
                <p className="text-sm italic text-muted-foreground">No description</p>
              )}
              <div className="mt-auto pt-1">
                <Badge
                  variant="secondary"
                  className="gap-1.5 border-primary/20 bg-primary/10 font-medium text-primary"
                >
                  <Users className="h-3.5 w-3.5" />
                  {category.staffCount ?? 0} staff
                </Badge>
              </div>
            </SectionCard>
          ))}
        </div>
      )}

      {/* Add/Edit dialog */}
      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit Category' : 'Add Category'}</DialogTitle>
            <DialogDescription>
              {editing
                ? 'Update the name or description of this staff category.'
                : 'Create a new category to classify staff members.'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="category-name">
                Name <span className="text-destructive">*</span>
              </Label>
              <Input
                id="category-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. PIPING WELDER"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="category-description">Description</Label>
              <Textarea
                id="category-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What this category covers (optional)"
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFormOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={() => void handleSubmit()} disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {editing ? 'Save Changes' : 'Add Category'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
