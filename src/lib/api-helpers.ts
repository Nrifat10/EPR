// Server-only API helpers: JSON responses, auth guards, pagination, activity logging
import 'server-only'
import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getSessionUser, hasPermission } from '@/lib/auth'
import type { SessionUser } from '@/lib/types'

export function ok<T>(data: T, status = 200) {
  return NextResponse.json(data as object, { status })
}

export function badRequest(error: string) {
  return NextResponse.json({ error }, { status: 400 })
}

export function unauthorized(error = 'Authentication required') {
  return NextResponse.json({ error }, { status: 401 })
}

export function forbidden(error = 'You do not have permission to perform this action') {
  return NextResponse.json({ error }, { status: 403 })
}

export function notFound(error = 'Resource not found') {
  return NextResponse.json({ error }, { status: 404 })
}

export function conflict(error: string) {
  return NextResponse.json({ error }, { status: 409 })
}

export function serverError(error = 'Internal server error') {
  return NextResponse.json({ error }, { status: 500 })
}

/** Returns the session user, or a 401 response to immediately return from the handler. */
export async function requireAuth(): Promise<SessionUser | NextResponse> {
  const user = await getSessionUser()
  if (!user) return unauthorized()
  return user
}

/** Returns the session user if they hold the permission, else a 401/403 response. */
export async function requirePermission(
  permission: string
): Promise<SessionUser | NextResponse> {
  const user = await getSessionUser()
  if (!user) return unauthorized()
  if (!hasPermission(user, permission)) return forbidden()
  return user
}

export function isResponse(x: unknown): x is NextResponse {
  return x instanceof NextResponse
}

export type Pagination = { page: number; pageSize: number; skip: number; take: number }

export function parsePagination(searchParams: URLSearchParams): Pagination {
  const page = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10) || 1)
  const allowed = [10, 25, 50, 100]
  const requested = parseInt(searchParams.get('pageSize') ?? '10', 10) || 10
  const pageSize = allowed.includes(requested) ? requested : 10
  return { page, pageSize, skip: (page - 1) * pageSize, take: pageSize }
}

export function paginatedResponse<T>(
  data: T[],
  total: number,
  p: Pagination,
  totals?: Record<string, number>
) {
  return ok({
    data,
    page: p.page,
    pageSize: p.pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / p.pageSize)),
    ...(totals ? { totals } : {}),
  })
}

/** Write an activity log row (never throws — feed must not break main operations). */
export async function logActivity(params: {
  user?: SessionUser | null
  action: string
  module: string
  description: string
  amount?: number | null
}): Promise<void> {
  try {
    await db.activityLog.create({
      data: {
        userId: params.user?.id ?? null,
        userName: params.user?.name ?? 'System',
        action: params.action,
        module: params.module,
        description: params.description,
        amount: params.amount ?? null,
      },
    })
  } catch {
    // activity logging must never break the main operation
  }
}

/** Safe float parse for request bodies (defaults to 0). */
export function toFloat(v: unknown, fallback = 0): number {
  if (typeof v === 'number' && isFinite(v)) return v
  if (typeof v === 'string' && v.trim() !== '') {
    const n = parseFloat(v)
    if (isFinite(n)) return n
  }
  return fallback
}

export function toInt(v: unknown, fallback = 0): number {
  if (typeof v === 'number' && isFinite(v)) return Math.round(v)
  if (typeof v === 'string' && v.trim() !== '') {
    const n = parseInt(v, 10)
    if (isFinite(n)) return n
  }
  return fallback
}

/** Parse an ISO / yyyy-mm-dd string into a Date (UTC-safe, avoids TZ drift). */
export function parseDate(v: unknown): Date | null {
  if (typeof v !== 'string' || !v.trim()) return null
  const d = new Date(v.length === 10 ? `${v}T00:00:00` : v)
  return isNaN(d.getTime()) ? null : d
}
