// AI chat API — GET (chat + messages), PATCH (rename), DELETE.
// Ownership enforced: only the chat's owner can touch it.
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import {
  ok,
  badRequest,
  notFound,
  serverError,
  requireAuth,
  isResponse,
} from '@/lib/api-helpers'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ id: string }> }

export async function GET(_req: NextRequest, ctx: Ctx) {
  const auth = await requireAuth()
  if (isResponse(auth)) return auth
  try {
    const { id } = await ctx.params
    const chat = await db.aiChat.findUnique({
      where: { id },
      include: {
        messages: {
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            role: true,
            content: true,
            toolEvents: true,
            attachments: true,
            drafts: true,
            promptTokens: true,
            completionTokens: true,
            isError: true,
            createdAt: true,
          },
        },
      },
    })
    if (!chat || chat.userId !== auth.id) return notFound('Chat not found')
    return ok({ chat })
  } catch {
    return serverError()
  }
}

export async function PATCH(req: NextRequest, ctx: Ctx) {
  const auth = await requireAuth()
  if (isResponse(auth)) return auth
  try {
    const { id } = await ctx.params
    const chat = await db.aiChat.findUnique({ where: { id }, select: { userId: true } })
    if (!chat || chat.userId !== auth.id) return notFound('Chat not found')
    const body = (await req.json()) as { title?: string }
    const title = (body.title ?? '').trim()
    if (!title) return badRequest('Title cannot be empty')
    const updated = await db.aiChat.update({
      where: { id },
      data: { title: title.slice(0, 120) },
      select: { id: true, title: true, updatedAt: true },
    })
    return ok({ chat: updated })
  } catch {
    return badRequest('Could not rename chat')
  }
}

export async function DELETE(_req: NextRequest, ctx: Ctx) {
  const auth = await requireAuth()
  if (isResponse(auth)) return auth
  try {
    const { id } = await ctx.params
    const chat = await db.aiChat.findUnique({ where: { id }, select: { userId: true } })
    if (!chat || chat.userId !== auth.id) return notFound('Chat not found')
    await db.aiChat.delete({ where: { id } })
    return ok({ deleted: true })
  } catch {
    return serverError()
  }
}
