'use client'

import { useCallback, useEffect, useState } from 'react'
import { Loader2, Lock, LockOpen, Pencil, Plus, ShieldCheck, Users } from 'lucide-react'
import { toast } from 'sonner'
import { api, ApiError } from '@/lib/api-client'
import { useAppStore, can } from '@/lib/store'
import { ALL_PERMISSIONS, BASELINE_PERMISSIONS, MODULES } from '@/lib/permissions'
import type { Role } from '@/lib/types'
import { PageHeader, SectionCard } from '@/components/app/shared/page-header'
import { ConfirmDelete } from '@/components/app/shared/confirm-delete'
import { EmptyState } from '@/components/app/shared/empty-state'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'

type RoleForm = {
  name: string
  description: string
  fullAccess: boolean
  selected: Set<string>
}

const EMPTY_FORM: RoleForm = {
  name: '',
  description: '',
  fullAccess: false,
  selected: new Set<string>(),
}

function isBuiltIn(role: Role): boolean {
  return role.name === 'Super Admin'
}

function isFullAccess(role: Role): boolean {
  return role.permissions.includes('*')
}

function permissionChips(role: Role): { chips: string[]; more: number } {
  const perms = role.permissions.filter((p) => p !== '*')
  return { chips: perms.slice(0, 4), more: Math.max(0, perms.length - 4) }
}

export function RolesView() {
  const { user } = useAppStore()
  const canCreate = can(user, 'roles.create')
  const canEdit = can(user, 'roles.edit')
  const canDelete = can(user, 'roles.delete')

  const [roles, setRoles] = useState<Role[]>([])
  const [loading, setLoading] = useState(true)

  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<Role | null>(null)
  const [form, setForm] = useState<RoleForm>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [nameError, setNameError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setLoading(true)
      const res = await api.get<{ data: Role[] }>('/api/roles')
      setRoles(res.data)
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Could not load roles')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  function openCreate() {
    setEditing(null)
    setForm({ ...EMPTY_FORM, selected: new Set() })
    setNameError(null)
    setDialogOpen(true)
  }

  function openEdit(role: Role) {
    setEditing(role)
    const full = isFullAccess(role)
    setForm({
      name: role.name,
      description: role.description ?? '',
      fullAccess: full,
      // When the role has "*", show the matrix fully checked so switching
      // "Full access" off starts from everything selected.
      selected: full ? new Set(ALL_PERMISSIONS) : new Set(role.permissions.filter((p) => p !== '*')),
    })
    setNameError(null)
    setDialogOpen(true)
  }

  function togglePermission(perm: string, checked: boolean) {
    setForm((f) => {
      const selected = new Set(f.selected)
      if (checked) selected.add(perm)
      else selected.delete(perm)
      return { ...f, selected }
    })
  }

  function toggleModule(module: string, actions: string[], checked: boolean) {
    setForm((f) => {
      const selected = new Set(f.selected)
      for (const a of actions) {
        const perm = `${module}.${a}`
        if (checked) selected.add(perm)
        else selected.delete(perm)
      }
      return { ...f, selected }
    })
  }

  async function handleSubmit() {
    const name = form.name.trim()
    if (!name) {
      setNameError('Role name is required')
      return
    }
    const permissions = form.fullAccess ? ['*'] : Array.from(form.selected)
    try {
      setSaving(true)
      if (editing) {
        await api.put(`/api/roles/${editing.id}`, {
          name,
          description: form.description,
          permissions,
        })
        toast.success('Role updated')
      } else {
        await api.post('/api/roles', {
          name,
          description: form.description,
          permissions,
        })
        toast.success('Role created')
      }
      setDialogOpen(false)
      await load()
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Could not save the role')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(role: Role) {
    try {
      await api.del(`/api/roles/${role.id}`)
      toast.success(`Role "${role.name}" deleted`)
      await load()
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Could not delete the role')
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Roles & Permissions"
        description="Define what each role can see and do across the system."
      >
        {canCreate ? (
          <Button onClick={openCreate}>
            <Plus className="h-4 w-4" />
            New Role
          </Button>
        ) : null}
      </PageHeader>

      <div className="flex items-start gap-3 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-emerald-900 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-100">
        <LockOpen className="mt-0.5 h-5 w-5 shrink-0" />
        <div className="min-w-0 text-sm">
          <p className="font-semibold">Full access is enabled for every signed-in user</p>
          <p className="mt-0.5 leading-relaxed text-emerald-800/90 dark:text-emerald-200/80">
            All options and modules are open to everyone who logs in — view, create, edit and
            delete. The role permissions below are kept for reference and organization; they
            only take effect if company-wide access is restricted again.
          </p>
        </div>
      </div>

      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <SectionCard key={i} className="h-44 animate-pulse">
              <span className="sr-only">Loading roles</span>
            </SectionCard>
          ))}
        </div>
      ) : roles.length === 0 ? (
        <SectionCard>
          <EmptyState
            icon={ShieldCheck}
            title="No roles yet"
            description="Create a role to group permissions and assign them to users."
            action={
              canCreate ? (
                <Button onClick={openCreate}>
                  <Plus className="h-4 w-4" />
                  New Role
                </Button>
              ) : undefined
            }
          />
        </SectionCard>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {roles.map((role) => {
            const builtIn = isBuiltIn(role)
            const full = isFullAccess(role)
            const { chips, more } = permissionChips(role)
            return (
              <SectionCard key={role.id} className="flex flex-col gap-4 p-5">
                <div className="flex items-start gap-3">
                  <div
                    className={
                      full
                        ? 'flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary'
                        : 'flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground'
                    }
                  >
                    <ShieldCheck className="h-5 w-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="truncate text-sm font-semibold">{role.name}</h3>
                      {builtIn ? (
                        <Badge variant="secondary" className="font-medium">
                          Built-in
                        </Badge>
                      ) : null}
                    </div>
                    <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                      {role.description || 'No description'}
                    </p>
                  </div>
                </div>

                <div className="flex min-h-[26px] flex-wrap items-center gap-1.5">
                  {full ? (
                    <Badge
                      variant="outline"
                      className="border-primary/30 bg-primary/10 font-medium text-primary"
                    >
                      Full access
                    </Badge>
                  ) : chips.length > 0 ? (
                    <>
                      {chips.map((p) => (
                        <Badge
                          key={p}
                          variant="outline"
                          className="max-w-full truncate font-mono text-[11px] font-normal text-muted-foreground"
                        >
                          {p}
                        </Badge>
                      ))}
                      {more > 0 ? (
                        <span className="text-xs font-medium text-muted-foreground">
                          +{more} more
                        </span>
                      ) : null}
                    </>
                  ) : (
                    <span className="text-xs text-muted-foreground">No permissions</span>
                  )}
                </div>

                <div className="mt-auto flex items-center justify-between border-t pt-3">
                  <Badge variant="outline" className="gap-1.5 font-medium">
                    <Users className="h-3 w-3" />
                    {role.userCount ?? 0} {role.userCount === 1 ? 'user' : 'users'}
                  </Badge>
                  <div className="flex items-center gap-1">
                    {canEdit ? (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-muted-foreground hover:text-foreground"
                        onClick={() => openEdit(role)}
                        aria-label={`Edit ${role.name}`}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                    ) : null}
                    {canDelete ? (
                      builtIn ? (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span
                              className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground"
                              tabIndex={0}
                              aria-label="Built-in role"
                            >
                              <Lock className="h-4 w-4" />
                            </span>
                          </TooltipTrigger>
                          <TooltipContent>Built-in role</TooltipContent>
                        </Tooltip>
                      ) : (
                        <ConfirmDelete
                          title="Delete role?"
                          description={`This will permanently remove the role "${role.name}". Roles assigned to users cannot be deleted.`}
                          onConfirm={() => handleDelete(role)}
                        />
                      )
                    ) : null}
                  </div>
                </div>
              </SectionCard>
            )
          })}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={(open) => { if (!saving) setDialogOpen(open) }}>
        <DialogContent className="max-h-[85vh] overflow-y-auto nice-scrollbar sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit Role' : 'New Role'}</DialogTitle>
            <DialogDescription>
              {editing
                ? 'Update the role details and its permissions.'
                : 'Name the role and pick which permissions it grants.'}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="role-name">Name</Label>
                <Input
                  id="role-name"
                  value={form.name}
                  onChange={(e) => {
                    setForm((f) => ({ ...f, name: e.target.value }))
                    setNameError(null)
                  }}
                  placeholder="e.g. Site Supervisor"
                  aria-invalid={!!nameError}
                />
                {nameError ? <p className="text-xs text-destructive">{nameError}</p> : null}
              </div>
              <div className="space-y-2 sm:col-span-1">
                <Label htmlFor="role-description">Description</Label>
                <Textarea
                  id="role-description"
                  value={form.description}
                  onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                  placeholder="What is this role for?"
                  rows={2}
                />
              </div>
            </div>

            <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
              <div className="min-w-0">
                <Label htmlFor="role-full-access">Full access</Label>
                <p className="text-xs text-muted-foreground">
                  Grant every permission in the system (Super Admin style).
                </p>
              </div>
              <Switch
                id="role-full-access"
                checked={form.fullAccess}
                onCheckedChange={(v) => setForm((f) => ({ ...f, fullAccess: v }))}
              />
            </div>

            <div className="flex items-center justify-between">
              <Label className="text-sm">Permissions</Label>
              <span className="text-xs font-medium text-muted-foreground">
                {form.fullAccess
                  ? 'All permissions granted'
                  : `${form.selected.size} of ${ALL_PERMISSIONS.length} selected`}
              </span>
            </div>

            <div className="grid gap-3">
              {MODULES.map((m) => {
                const modulePerms = m.actions.map((a) => `${m.module}.${a}`)
                // Baseline permissions count as always selected
                const selectedCount = modulePerms.filter(
                  (p) => form.selected.has(p) || BASELINE_PERMISSIONS.has(p)
                ).length
                const allSelected = selectedCount === modulePerms.length
                const allBaseline = modulePerms.every((p) => BASELINE_PERMISSIONS.has(p))
                return (
                  <div key={m.module} className="rounded-lg border p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium">{m.label}</span>
                      <label
                        className="flex cursor-pointer select-none items-center gap-2 text-xs text-muted-foreground"
                      >
                        Select all
                        <Checkbox
                          checked={form.fullAccess || allSelected}
                          disabled={form.fullAccess || allBaseline}
                          onCheckedChange={(v) => toggleModule(m.module, m.actions, v === true)}
                          aria-label={`Select all ${m.label} permissions`}
                        />
                      </label>
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
                      {m.actions.map((a) => {
                        const perm = `${m.module}.${a}`
                        const isBaseline = BASELINE_PERMISSIONS.has(perm)
                        const checked = form.fullAccess || form.selected.has(perm) || isBaseline
                        return (
                          <label
                            key={perm}
                            className={
                              'flex cursor-pointer select-none items-center gap-2 rounded-md border px-2.5 py-2 text-sm transition-colors hover:bg-muted/60' +
                              (checked ? ' has-[[data-state=checked]]:border-primary/50' : '') +
                              (isBaseline ? ' cursor-default bg-muted/40' : '')
                            }
                          >
                            <Checkbox
                              checked={checked}
                              disabled={form.fullAccess || isBaseline}
                              onCheckedChange={(v) => togglePermission(perm, v === true)}
                              aria-label={`${m.label}: ${m.actionLabels[a] ?? a}`}
                            />
                            <span className="truncate">
                              {m.actionLabels[a] ?? a}
                              {isBaseline && <span className="ml-1 text-[11px] font-medium text-muted-foreground">· all users</span>}
                            </span>
                          </label>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
            </div>

            <p className="text-xs text-muted-foreground">
              Every permission is currently granted to all signed-in users (company-wide full
              access). The selections stored on this role apply only if that access is later
              restricted.
            </p>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={() => void handleSubmit()} disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {editing ? 'Save Changes' : 'Create Role'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
