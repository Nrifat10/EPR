// Users API — GET (never exposes password hashes) / POST (create with scrypt hash)
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

const userSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  email: z.email('Invalid email address'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
  roleId: z.string().nullable().optional(),
  avatar: z.string().nullable().optional(),
})

export async function GET() {
  try {
    const auth = await requirePermission('users.view')
    if (isResponse(auth)) return auth

    const users = await db.user.findMany({
      orderBy: { createdAt: 'desc' },
      include: userInclude,
    })
    return ok({ data: users.map(mapUser) })
  } catch {
    return serverError()
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requirePermission('users.create')
    if (isResponse(auth)) return auth

    let raw: unknown
    try {
      raw = await req.json()
    } catch {
      return badRequest('Invalid JSON body')
    }
    const parsed = userSchema.safeParse(raw)
    if (!parsed.success) {
      return badRequest(parsed.error.issues[0]?.message ?? 'Invalid request body')
    }
    const body = parsed.data

    const name = body.name.trim()
    if (!name) return badRequest('Name is required')
    const email = body.email.trim()
    if (!email) return badRequest('Email is required')

    const allUsers = await db.user.findMany({ select: { email: true } })
    if (allUsers.some((u) => u.email.toLowerCase() === email.toLowerCase())) {
      return conflict('A user with this email already exists')
    }

    if (body.roleId) {
      const role = await db.role.findUnique({ where: { id: body.roleId } })
      if (!role) return badRequest('Selected role does not exist')
    }

    const passwordHash = await hashPassword(body.password)
    const created = await db.user.create({
      data: {
        name,
        email,
        password: passwordHash,
        roleId: body.roleId || null,
        avatar: body.avatar || null,
      },
      include: userInclude,
    })
    await logActivity({
      user: auth,
      action: 'created',
      module: 'user',
      description: `User created: ${name}`,
    })
    return ok(mapUser(created), 201)
  } catch {
    return serverError()
  }
}
