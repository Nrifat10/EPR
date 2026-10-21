// AI request logs API — admin audit feed with pagination + filters.
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import {
  ok,
  serverError,
  requirePermission,
  isResponse,
  parsePagination,
  paginatedResponse,
} from '@/lib/api-helpers'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const auth = await requirePermission('ai.viewlogs')
  if (isResponse(auth)) return auth
  try {
    const sp = req.nextUrl.searchParams
    const p = parsePagination(sp)
    const q = (sp.get('q') ?? '').trim().toLowerCase()
    const where: Record<string, unknown> = {}
    if (q) {
      where.OR = [
        { question: { contains: q } },
        { userName: { contains: q } },
        { error: { contains: q } },
      ]
    }
    const [rows, total] = await Promise.all([
      db.aiUsageLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: p.skip,
        take: p.take,
        select: {
          id: true,
          userName: true,
          question: true,
          toolsCalled: true,
          promptTokens: true,
          completionTokens: true,
          totalTokens: true,
          costSar: true,
          durationMs: true,
          provider: true,
          model: true,
          success: true,
          error: true,
          createdAt: true,
        },
      }),
      db.aiUsageLog.count({ where }),
    ])
    return paginatedResponse(rows, total, p)
  } catch {
    return serverError()
  }
}
