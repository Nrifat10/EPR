'use client'

// Transaction Categories — manage income & expense categories.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Loader2, Pencil, Plus, Tag, TrendingDown, TrendingUp } from 'lucide-react'

import { api } from '@/lib/api-client'
import { can, useAppStore } from '@/lib/store'
import type { TransactionCategoryRow, TransactionType } from '@/lib/types'
import { cn } from '@/lib/utils'

import { Badge } from '@/components/ui/badge'
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

import { ConfirmDelete } from '../shared/confirm-delete'
import { EmptyState, TableSkeleton } from '../shared/empty-state'
import { PageHeader, SectionCard } from '../shared/page-header'

type CategoriesResponse = { data: TransactionCategoryRow[] }

function CategoryCard({
  title,
  tone,
  categories,
  loading,
  canCreate,
  canEdit,
  canDelete,
  onAdd,
  onEdit,
  onDelete,
}: {
  title: string
  tone: 'income' | 'expense'
  categories: TransactionCategoryRow[]
  loading: boolean
  canCreate: boolean
  canEdit: boolean
  canDelete: boolean
  onAdd: () => void
  onEdit: (category: TransactionCategoryRow) => void
  onDelete: (category: TransactionCategoryRow) => Promise<void>
}) {
  const isIncome = tone === 'income'
  return (
    <SectionCard className="overflow-hidden">
      <div className="flex items-center justify-between gap-2 border-b p-4 sm:p-5">
        <div className="flex items-center gap-3">
          <span
            className={cn(
              'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg',
              isIncome
                ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400'
                : 'bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-400'
            )}
          >
            {isIncome ? (
              <TrendingUp className="h-4.5 w-4.5" />
            ) : (
              <TrendingDown className="h-4.5 w-4.5" />
            )}
          </span>
          <div>
            <h3 className="text-sm font-semibold sm:text-base">{title}</h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {categories.length} {categories.length === 1 ? 'category' : 'categories'}
            </p>
          </div>
        </div>
        {canCreate ? (
          <Button variant="ghost" size="sm" className="h-8" onClick={onAdd}>
            <Plus className="h-4 w-4" />
            Add
          </Button>
        ) : null}
      </div>
      {loading ? (
        <TableSkeleton rows={4} cols={3} />
      ) : categories.length === 0 ? (
        <EmptyState
          icon={Tag}
          title={`No ${tone} categories`}
          description={
            canCreate
              ? 'Create a category to start grouping transactions.'
              : 'No categories have been created yet.'
          }
          action={
            canCreate ? (
              <Button variant="outline" size="sm" onClick={onAdd}>
                <Plus className="h-4 w-4" />
                Add Category
              </Button>
            ) : undefined
          }
          className="py-10"
        />
      ) : (
        <ul className="nice-scrollbar max-h-[460px] divide-y overflow-y-auto">
          {categories.map((category) => (
            <li
              key={category.id}
              className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-muted/50 sm:px-5"
            >
              <span
                className={cn(
                  'flex h-8 w-8 shrink-0 items-center justify-center rounded-full',
                  isIncome
                    ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-400'
                    : 'bg-rose-50 text-rose-700 dark:bg-rose-950/60 dark:text-rose-400'
                )}
              >
                <Tag className="h-4 w-4" />
              </span>
              <span className="min-w-0 flex-1 truncate text-sm font-medium">
                {category.name}
              </span>
              <Badge
                variant="secondary"
                className="shrink-0 tabular-nums font-medium"
              >
                {category.transactionCount ?? 0}{' '}
                {category.transactionCount === 1 ? 'transaction' : 'transactions'}
              </Badge>
              <div className="flex shrink-0 items-center gap-1">
                {canEdit ? (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-muted-foreground hover:text-foreground"
                    onClick={() => onEdit(category)}
                    aria-label={`Edit ${category.name}`}
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                ) : null}
                {canDelete ? (
                  <ConfirmDelete
                    onConfirm={() => onDelete(category)}
                    title="Delete category?"
                    description={`"${category.name}" will be permanently removed. Categories that are used by transactions cannot be deleted.`}
                  />
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  )
}

export function TransactionCategoriesView() {
  const { user } = useAppStore()
  const canCreate = can(user, 'accounts.create')
  const canEdit = can(user, 'accounts.edit')
  const canDelete = can(user, 'accounts.delete')

  const [categories, setCategories] = useState<TransactionCategoryRow[]>([])
  const [loading, setLoading] = useState(true)

  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<TransactionCategoryRow | null>(null)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState<{ name: string; type: TransactionType }>({
    name: '',
    type: 'income',
  })

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await api.get<CategoriesResponse>('/api/transaction-categories')
      setCategories(res.data)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to load categories')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const incomeCategories = useMemo(
    () => categories.filter((c) => c.type === 'income'),
    [categories]
  )
  const expenseCategories = useMemo(
    () => categories.filter((c) => c.type === 'expense'),
    [categories]
  )

  function openAdd(type: TransactionType = 'income') {
    setEditing(null)
    setForm({ name: '', type })
    setDialogOpen(true)
  }

  function openEdit(category: TransactionCategoryRow) {
    setEditing(category)
    setForm({ name: category.name, type: category.type })
    setDialogOpen(true)
  }

  async function handleSubmit() {
    const name = form.name.trim()
    if (!name) {
      toast.error('Name is required')
      return
    }
    setSaving(true)
    try {
      if (editing) {
        await api.put(`/api/transaction-categories/${editing.id}`, {
          name,
          type: form.type,
        })
        toast.success('Category updated')
      } else {
        await api.post('/api/transaction-categories', { name, type: form.type })
        toast.success('Category added')
      }
      setDialogOpen(false)
      void load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to save category')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(category: TransactionCategoryRow) {
    try {
      await api.del(`/api/transaction-categories/${category.id}`)
      toast.success('Category deleted')
      void load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to delete category')
    }
  }

  return (
    <div className="flex flex-col gap-4 sm:gap-6">
      <PageHeader
        title="Transaction Categories"
        description="Organize income and expense entries into categories"
      >
        {canCreate ? (
          <Button size="sm" onClick={() => openAdd('income')}>
            <Plus className="h-4 w-4" />
            Add Category
          </Button>
        ) : null}
      </PageHeader>

      <div className="grid gap-4 lg:grid-cols-2 sm:gap-6">
        <CategoryCard
          title="Income Categories"
          tone="income"
          categories={incomeCategories}
          loading={loading}
          canCreate={canCreate}
          canEdit={canEdit}
          canDelete={canDelete}
          onAdd={() => openAdd('income')}
          onEdit={openEdit}
          onDelete={handleDelete}
        />
        <CategoryCard
          title="Expense Categories"
          tone="expense"
          categories={expenseCategories}
          loading={loading}
          canCreate={canCreate}
          canEdit={canEdit}
          canDelete={canDelete}
          onAdd={() => openAdd('expense')}
          onEdit={openEdit}
          onDelete={handleDelete}
        />
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle>
              {editing ? 'Edit Category' : 'Add Category'}
            </DialogTitle>
            <DialogDescription>
              {editing
                ? 'Update the category name or type.'
                : 'Create a category for grouping income or expense entries.'}
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault()
              void handleSubmit()
            }}
            className="space-y-4"
          >
            <div className="space-y-2">
              <Label htmlFor="category-name">Name</Label>
              <Input
                id="category-name"
                value={form.name}
                onChange={(e) =>
                  setForm((f) => ({ ...f, name: e.target.value }))
                }
                placeholder="e.g. Equipment Rental"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="category-type">Type</Label>
              <Select
                value={form.type}
                onValueChange={(v) =>
                  setForm((f) => ({ ...f, type: v as TransactionType }))
                }
              >
                <SelectTrigger id="category-type" className="w-full">
                  <SelectValue placeholder="Select type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="income">Income</SelectItem>
                  <SelectItem value="expense">Expense</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setDialogOpen(false)}
                disabled={saving}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : null}
                {editing ? 'Save Changes' : 'Add Category'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
