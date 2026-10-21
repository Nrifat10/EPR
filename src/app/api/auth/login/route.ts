// POST /api/auth/login — email + password → session cookie
import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { verifyPassword, createSession, SESSION_COOKIE } from '@/lib/auth'
import { ok, badRequest, unauthorized, serverError, logActivity } from '@/lib/api-helpers'
import type { SessionUser } from '@/lib/types'

const bodySchema = z.object({
  email: z.preprocess(
    (v) => (typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined),
    z.email('Please enter a valid email address')
  ),
  password: z.string('Password is required').min(1, 'Password is required'),
})

function parsePermissions(raw: string | null | undefined): string[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.map(String) : []
  } catch {
    return []
  }
}

export async function POST(req: NextRequest) {
  try {
    let json: unknown = null
    try {
      json = await req.json()
    } catch {
      json = null
    }
    const parsed = bodySchema.safeParse(json)
    if (!parsed.success) {
      return badRequest(parsed.error.issues[0]?.message ?? 'Invalid request data')
    }
    const { email, password } = parsed.data

    const user = await db.user.findUnique({
      where: { email: email.toLowerCase() },
      include: { role: true },
    })
    if (!user || !user.isActive) {
      return unauthorized('Invalid email or password')
    }

    const valid = await verifyPassword(password, user.password)
    if (!valid) {
      return unauthorized('Invalid email or password')
    }

    const token = await createSession(user.id)

    const sessionUser: SessionUser = {
      id: user.id,
      name: user.name,
      email: user.email,
      avatar: user.avatar,
      role: user.role
        ? {
            id: user.role.id,
            name: user.role.name,
            permissions: parsePermissions(user.role.permissions),
          }
        : null,
    }

    await logActivity({
      user: sessionUser,
      action: 'login',
      module: 'user',
      description: `${user.name} signed in`,
    })

    // Token is ALSO returned in the JSON body: the client stores it and sends
    // it as an Authorization: Bearer header. Required for the sandbox preview
    // iframe where SameSite=Lax cookies are blocked by the browser.
    const res = ok({ user: sessionUser, token })
    res.cookies.set(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 30 * 24 * 60 * 60, // 30 days
    })
    return res
  } catch (err) {
    console.error('[api/auth/login]', err)
    return serverError()
  }
}
