// User [id] API — PUT / DELETE (self-delete & last-Super-Admin guards)
import { NextRequest } from 'next/server'
import { Prisma } from '@prisma/client'
import { z } from 'zod'
import { db } from '@/lib/db'
import { hashPassword } from '@/lib/auth'
import type { UserRow } from '@/lib/types'
import {
  ok,
  badRequest,
  conflict,
  notFound,
  serverError,
  requirePermission,
  isResponse,
  logActivity,
} from '@/lib/api-helpers'

const userInclude = { role: { select: { id: true, name: true } } } satisfies Prisma.UserInclude

type UserWithRole = Prisma.UserGetPayload<{ include: typeof userInclude }>

function mapUser(u: UserWithRole): UserRow {
  // Explicit mapping — the password hash is NEVER serialized
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    avatar: u.avatar,
    isActive: u.isActive,
    createdAt: u.createdAt.toISOString(),
    role: u.role ? { id: u.role.id, name: u.role.name } : null,
  }
}

const userUpdateSchema = z.object({
  name: z.string().min(1, 'Name is required').optional(),
  email: z.email('Invalid email address').optional(),
  password: z
    .string()
    .min(6, 'Password must be at least 6 characters')
    .optional(),
  roleId: z.string().nullable().optional(),
  isActive: z.boolean().optional(),
  avatar: z.string().nullable().optional(),
})

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requirePermission('users.edit')
    if (isResponse(auth)) return auth

    const { id } = await params
    const existing = await db.user.findUnique({ where: { id } })
    if (!existing) return notFound('User not found')

    let raw: unknown
    try {
      raw = await req.json()
    } catch {
      return badRequest('Invalid JSON body')
    }
    const parsed = userUpdateSchema.safeParse(raw)
    if (!parsed.success) {
      return badRequest(parsed.error.issues[0]?.message ?? 'Invalid request body')
    }
    const body = parsed.data

    const data: Prisma.UserUpdateInput = {}

    if (body.name !== undefined) {
      const name = body.name.trim()
      if (!name) return badRequest('Name is required')
      data.name = name
    }

    if (body.email !== undefined) {
      const email = body.email.trim()
      if (!email) return badRequest('Email is required')
      const allUsers = await db.user.findMany({ select: { id: true, email: true } })
      if (
        allUsers.some(
          (u) => u.id !== id && u.email.toLowerCase() === email.toLowerCase()
        )
      ) {
        return conflict('A user with this email already exists')
      }
      data.email = email
    }

    if (body.password !== undefined) {
      data.password = await hashPassword(body.password)
    }

    if (body.roleId !== undefined) {
      if (body.roleId) {
        const role = await db.role.findUnique({ where: { id: body.roleId } })
        if (!role) return badRequest('Selected role does not exist')
        data.role = { connect: { id: body.roleId } }
      } else {
        data.role = { disconnect: true }
      }
    }

    if (body.isActive !== undefined) data.isActive = body.isActive
    if (body.avatar !== undefined) data.avatar = body.avatar || null

    const updated = await db.user.update({
      where: { id },
      data,
      include: userInclude,
    })
    await logActivity({
      user: auth,
      action: 'updated',
      module: 'user',
      description: `User updated: ${updated.name}`,
    })
    return ok(mapUser(updated))
  } catch {
    return serverError()
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requirePermission('users.delete')
    if (isResponse(auth)) return auth

    const { id } = await params
    const existing = await db.user.findUnique({ where: { id } })
    if (!existing) return notFound('User not found')

    if (id === auth.id) {
      return conflict('You cannot delete your own account.')
    }

    // Guard: cannot delete the last active Super Admin
    const superAdminRole = await db.role.findFirst({
      where: { name: 'Super Admin' },
    })
    if (superAdminRole && existing.roleId === superAdminRole.id) {
      const activeSuperAdmins = await db.user.count({
        where: { roleId: superAdminRole.id, isActive: true },
      })
      if (activeSuperAdmins <= 1) {
        return conflict('Cannot delete the last Super Admin.')
      }
    }

    // Sessions cascade automatically via the schema
    await db.user.delete({ where: { id } })
    await logActivity({
      user: auth,
      action: 'deleted',
      module: 'user',
      description: `User deleted: ${existing.name}`,
    })
    return ok({ success: true })
  } catch {
    return serverError()
  }
}
