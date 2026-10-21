'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Loader2, Lock, Pencil, Plus, UserPlus } from 'lucide-react'
import { toast } from 'sonner'
import { api, ApiError } from '@/lib/api-client'
import { useAppStore, can } from '@/lib/store'
import { formatDate } from '@/lib/format'
import type { Role, UserRow } from '@/lib/types'
import { PageHeader, SectionCard } from '@/components/app/shared/page-header'
import { AvatarInitials } from '@/components/app/shared/avatar-initials'
import { CategoryChip, StatusBadge } from '@/components/app/shared/status-badge'
import { ConfirmDelete } from '@/components/app/shared/confirm-delete'
import { EmptyState, TableSkeleton } from '@/components/app/shared/empty-state'
import { fileToDataUrl } from '@/components/app/views/settings'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'

type UserForm = {
  name: string
  email: string
  password: string
  roleId: string // '' = no role
  isActive: boolean
  avatar: string | null
}

const EMPTY_FORM: UserForm = {
  name: '',
  email: '',
  password: '',
  roleId: '',
  isActive: true,
  avatar: null,
}

export function UsersView() {
  const { user } = useAppStore()
  const canCreate = can(user, 'users.create')
  const canEdit = can(user, 'users.edit')
  const canDelete = can(user, 'users.delete')

  const [users, setUsers] = useState<UserRow[]>([])
  const [roles, setRoles] = useState<Role[]>([])
  const [loading, setLoading] = useState(true)

  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<UserRow | null>(null)
  const [form, setForm] = useState<UserForm>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [errors, setErrors] = useState<{ name?: string; email?: string; password?: string }>({})
  const [uploading, setUploading] = useState(false)
  const avatarInputRef = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    try {
      setLoading(true)
      const [usersRes, rolesRes] = await Promise.all([
        api.get<{ data: UserRow[] }>('/api/users'),
        api.get<{ data: Role[] }>('/api/roles').catch(() => ({ data: [] as Role[] })),
      ])
      setUsers(usersRes.data)
      setRoles(rolesRes.data)
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Could not load users')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  function openCreate() {
    setEditing(null)
    setForm(EMPTY_FORM)
    setErrors({})
    setDialogOpen(true)
  }

  function openEdit(u: UserRow) {
    setEditing(u)
    setForm({
      name: u.name,
      email: u.email,
      password: '',
      roleId: u.role?.id ?? '',
      isActive: u.isActive,
      avatar: u.avatar,
    })
    setErrors({})
    setDialogOpen(true)
  }

  function setField<K extends keyof UserForm>(key: K, value: UserForm[K]) {
    setForm((f) => ({ ...f, [key]: value }))
    setErrors((e) => ({ ...e, [key]: undefined }))
  }

  async function handleAvatarSelected(file: File | undefined) {
    if (!file) return
    try {
      setUploading(true)
      const dataUrl = await fileToDataUrl(file, 256)
      setField('avatar', dataUrl)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not process the image')
    } finally {
      setUploading(false)
      if (avatarInputRef.current) avatarInputRef.current.value = ''
    }
  }

  async function handleSubmit() {
    const next: typeof errors = {}
    const name = form.name.trim()
    const email = form.email.trim()
    if (!name) next.name = 'Full name is required'
    if (!email) next.email = 'Email is required'
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) next.email = 'Enter a valid email address'
    if (!editing && form.password.length < 6) {
      next.password = 'Password must be at least 6 characters'
    }
    if (editing && form.password && form.password.length < 6) {
      next.password = 'Password must be at least 6 characters'
    }
    setErrors(next)
    if (Object.keys(next).length > 0) return

    try {
      setSaving(true)
      if (editing) {
        await api.put(`/api/users/${editing.id}`, {
          name,
          email,
          ...(form.password ? { password: form.password } : {}),
          roleId: form.roleId || null,
          isActive: form.isActive,
          avatar: form.avatar,
        })
        toast.success('User updated')
      } else {
        await api.post('/api/users', {
          name,
          email,
          password: form.password,
          roleId: form.roleId || null,
          avatar: form.avatar,
        })
        toast.success('User created')
      }
      setDialogOpen(false)
      await load()
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Could not save the user')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(u: UserRow) {
    try {
      await api.del(`/api/users/${u.id}`)
      toast.success(`User "${u.name}" deleted`)
      await load()
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Could not delete the user')
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Users"
        description="Manage the people who can sign in to this system and what they can do."
      >
        {canCreate ? (
          <Button onClick={openCreate}>
            <Plus className="h-4 w-4" />
            New User
          </Button>
        ) : null}
      </PageHeader>

      <SectionCard>
        {loading ? (
          <TableSkeleton rows={4} cols={5} />
        ) : users.length === 0 ? (
          <EmptyState
            icon={UserPlus}
            title="No users yet"
            description="Create the first user account to invite teammates into the system."
            action={
              canCreate ? (
                <Button onClick={openCreate}>
                  <Plus className="h-4 w-4" />
                  New User
                </Button>
              ) : undefined
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <Table className="min-w-[720px]">
              <TableHeader>
                <TableRow>
                  <TableHead>User</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className="w-24 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.map((u) => {
                  const isSelf = user?.id === u.id
                  return (
                    <TableRow key={u.id}>
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <AvatarInitials name={u.name} src={u.avatar} />
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold">
                              {u.name}
                              {isSelf ? (
                                <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                                  (you)
                                </span>
                              ) : null}
                            </p>
                            <p className="truncate text-xs text-muted-foreground">{u.email}</p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        {u.role ? (
                          <CategoryChip label={u.role.name} />
                        ) : (
                          <span className="text-sm text-muted-foreground">No role</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <StatusBadge kind={u.isActive ? 'active' : 'inactive'} label={u.isActive ? 'active' : 'inactive'} />
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {formatDate(u.createdAt)}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center justify-end gap-1">
                          {canEdit ? (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-muted-foreground hover:text-foreground"
                              onClick={() => openEdit(u)}
                              aria-label={`Edit ${u.name}`}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                          ) : null}
                          {canDelete ? (
                            isSelf ? (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <span
                                    className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground"
                                    tabIndex={0}
                                    aria-label="This is you"
                                  >
                                    <Lock className="h-4 w-4" />
                                  </span>
                                </TooltipTrigger>
                                <TooltipContent>This is you</TooltipContent>
                              </Tooltip>
                            ) : (
                              <ConfirmDelete
                                title="Delete user?"
                                description={`This will permanently remove "${u.name}" and end all of their active sessions.`}
                                onConfirm={() => handleDelete(u)}
                              />
                            )
                          ) : null}
                        </div>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </SectionCard>

      <Dialog open={dialogOpen} onOpenChange={(open) => { if (!saving) setDialogOpen(open) }}>
        <DialogContent className="max-h-[85vh] overflow-y-auto nice-scrollbar sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit User' : 'New User'}</DialogTitle>
            <DialogDescription>
              {editing
                ? 'Update account details, role and access status.'
                : 'Create a new account and assign what it can do.'}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4">
            <div className="space-y-2">
              <Label htmlFor="user-name">Full Name</Label>
              <Input
                id="user-name"
                value={form.name}
                onChange={(e) => setField('name', e.target.value)}
                placeholder="e.g. Ahmed Al Harbi"
                aria-invalid={!!errors.name}
              />
              {errors.name ? <p className="text-xs text-destructive">{errors.name}</p> : null}
            </div>

            <div className="space-y-2">
              <Label htmlFor="user-email">Email</Label>
              <Input
                id="user-email"
                type="email"
                value={form.email}
                onChange={(e) => setField('email', e.target.value)}
                placeholder="name@company.com"
                aria-invalid={!!errors.email}
              />
              {errors.email ? <p className="text-xs text-destructive">{errors.email}</p> : null}
            </div>

            <div className="space-y-2">
              <Label htmlFor="user-password">Password</Label>
              <Input
                id="user-password"
                type="password"
                value={form.password}
                onChange={(e) => setField('password', e.target.value)}
                placeholder={editing ? 'Leave blank to keep current password' : 'Minimum 6 characters'}
                aria-invalid={!!errors.password}
              />
              {errors.password ? (
                <p className="text-xs text-destructive">{errors.password}</p>
              ) : editing ? (
                <p className="text-xs text-muted-foreground">Leave blank to keep current password</p>
              ) : null}
            </div>

            <div className="space-y-2">
              <Label htmlFor="user-role">Role</Label>
              <Select
                value={form.roleId || 'none'}
                onValueChange={(v) => setField('roleId', v === 'none' ? '' : v)}
              >
                <SelectTrigger id="user-role" className="w-full">
                  <SelectValue placeholder="Select a role" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No role</SelectItem>
                  {roles.map((r) => (
                    <SelectItem key={r.id} value={r.id}>
                      {r.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {roles.length === 0
                  ? 'No roles available to assign'
                  : 'Controls which modules and actions this user can access'}
              </p>
            </div>

            <div className="space-y-2">
              <Label>Avatar</Label>
              <div className="flex flex-wrap items-center gap-4">
                <AvatarInitials name={form.name || 'New User'} src={form.avatar} size="lg" />
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    ref={avatarInputRef}
                    type="file"
                    accept="image/*"
                    className="sr-only"
                    onChange={(e) => void handleAvatarSelected(e.target.files?.[0])}
                    aria-label="Upload avatar"
                    disabled={uploading}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => avatarInputRef.current?.click()}
                    disabled={uploading}
                  >
                    {uploading ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <UserPlus className="h-4 w-4" />
                    )}
                    Upload
                  </Button>
                  {form.avatar ? (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setField('avatar', null)}
                      className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                    >
                      Remove
                    </Button>
                  ) : null}
                </div>
              </div>
              <p className="text-xs text-muted-foreground">Optional. Images are resized to 256 px.</p>
            </div>

            {editing ? (
              <div className="flex items-center justify-between rounded-lg border p-3">
                <div className="space-y-0.5">
                  <Label htmlFor="user-active">Active</Label>
                  <p className="text-xs text-muted-foreground">
                    Inactive users cannot sign in to the system.
                  </p>
                </div>
                <Switch
                  id="user-active"
                  checked={form.isActive}
                  onCheckedChange={(v) => setField('isActive', v)}
                />
              </div>
            ) : null}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={() => void handleSubmit()} disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {editing ? 'Save Changes' : 'Create User'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
