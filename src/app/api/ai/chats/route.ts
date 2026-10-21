// AI chats API — list (with search) + create. Each user sees only their own.
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import {
  ok,
  badRequest,
  serverError,
  requireAuth,
  isResponse,
} from '@/lib/api-helpers'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const auth = await requireAuth()
  if (isResponse(auth)) return auth
  try {
    const q = (req.nextUrl.searchParams.get('q') ?? '').trim().toLowerCase()
    const chats = await db.aiChat.findMany({
      where: { userId: auth.id },
      select: {
        id: true,
        title: true,
        lastPreview: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { updatedAt: 'desc' },
      take: 200,
    })
    const filtered = q
      ? chats.filter(
          (c) =>
            c.title.toLowerCase().includes(q) || c.lastPreview.toLowerCase().includes(q)
        )
      : chats
    return ok({ chats: filtered })
  } catch {
    return serverError()
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth()
  if (isResponse(auth)) return auth
  try {
    let title = 'New chat'
    try {
      const body = (await req.json()) as { title?: string }
      if (typeof body.title === 'string' && body.title.trim()) {
        title = body.title.trim().slice(0, 120)
      }
    } catch {
      // empty body is fine
    }
    const chat = await db.aiChat.create({
      data: { userId: auth.id, title },
      select: { id: true, title: true, lastPreview: true, createdAt: true, updatedAt: true },
    })
    return ok({ chat })
  } catch {
    return badRequest('Could not create chat')
  }
}
