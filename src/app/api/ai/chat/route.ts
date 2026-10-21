// AI chat SSE endpoint — runs the tool-calling agent loop and streams events:
//   meta → status → tool* → delta* → done | error
// Stop button: the client aborts the fetch; req.signal is polled between
// rounds and during the paced reveal, so the loop halts cleanly.
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getSessionUser, hasPermission } from '@/lib/auth'
import { getAiProviderConfig, getMonthUsage, effectiveModel } from '@/lib/ai/settings'
import {
  runAgent,
  streamAnswer,
  deriveTitle,
  extractDrafts,
  estimateCost,
  AbortError,
  type SseEvent,
  type Attachment,
} from '@/lib/ai/agent'
import type { PageContext } from '@/lib/ai/prompt'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

type Body = {
  chatId?: string
  message?: string
  attachments?: { name: string; mime: string; size: number; text?: string }[]
  pageContext?: PageContext
}

export async function POST(req: NextRequest) {
  const user = await getSessionUser()
  if (!user) {
    return new Response(JSON.stringify({ error: 'Authentication required' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    })
  }
  if (!hasPermission(user, 'ai.use')) {
    return new Response(
      JSON.stringify({ error: 'You do not have permission to use the AI Assistant' }),
      { status: 403, headers: { 'Content-Type': 'application/json' } }
    )
  }

  let body: Body
  try {
    body = (await req.json()) as Body
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const question = (body.message ?? '').trim()
  const files = body.attachments ?? []
  if (!question && files.length === 0) {
    return new Response(JSON.stringify({ error: 'Message cannot be empty' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const encoder = new TextEncoder()
  const started = Date.now()

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false
      const send = (e: SseEvent) => {
        if (closed) return
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(e)}\n\n`))
        } catch {
          closed = true
        }
      }
      const aborted = () => req.signal.aborted || closed

      // ── resolve / create the chat ──
      let chatId = body.chatId ?? null
      try {
        if (chatId) {
          const chat = await db.aiChat.findUnique({ where: { id: chatId }, select: { userId: true } })
          if (!chat || chat.userId !== user.id) chatId = null
        }
        if (!chatId) {
          const chat = await db.aiChat.create({
            data: { userId: user.id, title: deriveTitle(question || files[0]?.name || 'File question') },
            select: { id: true },
          })
          chatId = chat.id
        }
      } catch {
        send({ type: 'error', message: 'Could not open a chat. Please try again.' })
        closed = true
        controller.close()
        return
      }

      // ── persist the user message ──
      const attMeta = files.map((f) => ({
        name: f.name,
        type: f.mime,
        size: f.size,
        extractedChars: (f.text ?? '').length,
      }))
      const userMessage = await db.aiChatMessage.create({
        data: {
          chatId,
          role: 'user',
          content: question || `(uploaded ${files.map((f) => f.name).join(', ')})`,
          attachments: JSON.stringify(attMeta),
        },
        select: { id: true },
      })
      send({ type: 'meta', chatId, userMessageId: userMessage.id })

      // ── monthly limit gate ──
      try {
        const cfg = await getAiProviderConfig()
        if (cfg.monthlyLimitSar > 0) {
          const now = new Date()
          const usage = await getMonthUsage(now.getUTCFullYear(), now.getUTCMonth() + 1)
          if (usage.costSar >= cfg.monthlyLimitSar) {
            const msg = `Monthly AI usage limit reached (SAR ${usage.costSar.toFixed(2)} of SAR ${cfg.monthlyLimitSar.toFixed(2)}). The assistant is paused until next month — the rest of the ERP keeps working normally. An admin can raise the limit in Settings → AI Assistant.`
            await saveError(chatId, user.id, user.name, question, msg)
            send({ type: 'error', message: msg })
            closed = true
            controller.close()
            return
          }
        }
      } catch {
        // limit check must not block the chat
      }

      // ── load recent history (user + assistant turns only) ──
      const history = await db.aiChatMessage
        .findMany({
          where: { chatId, id: { not: userMessage.id } },
          orderBy: { createdAt: 'desc' },
          take: 16,
          select: { role: true, content: true, isError: true },
        })
        .then((rows) =>
          rows
            .reverse()
            .filter((r) => !r.isError)
            .map((r) => ({ role: r.role, content: r.content }))
        )

      const attachments: Attachment[] = files.map((f) => ({
        name: f.name,
        mime: f.mime,
        size: f.size,
        text: f.text ?? '',
      }))

      // ── run the agent ──
      send({ type: 'status', text: 'Thinking…' })
      try {
        const result = await runAgent({
          user,
          question,
          attachments,
          page: body.pageContext ?? null,
          history,
          send,
          aborted,
        })

        // paced reveal of the final answer
        const { cleaned, drafts } = extractDrafts(result.answer)
        send({ type: 'status', text: 'Writing answer…' })
        const finished = await streamAnswer(cleaned, send, aborted)

        const cfg = await getAiProviderConfig()
        const costSar = estimateCost(
          cfg.inCostPer1k,
          cfg.outCostPer1k,
          result.promptTokens,
          result.completionTokens
        )

        const assistantMessage = await db.aiChatMessage.create({
          data: {
            chatId,
            role: 'assistant',
            content: finished || aborted() ? cleaned : result.answer,
            toolEvents: JSON.stringify(result.toolEvents),
            attachments: '[]',
            drafts: JSON.stringify(drafts),
            promptTokens: result.promptTokens,
            completionTokens: result.completionTokens,
          },
          select: { id: true },
        })

        const title = await db.aiChat.update({
          where: { id: chatId },
          data: {
            lastPreview: cleaned
              .replace(/%%DRAFT:\d+%%/g, '[Draft] ')
              .replace(/[#*`|]/g, '')
              .slice(0, 140),
            updatedAt: new Date(),
            ...(history.length === 0 ? { title: deriveTitle(question) } : {}),
          },
          select: { title: true },
        })

        await db.aiUsageLog.create({
          data: {
            userId: user.id,
            userName: user.name,
            chatId,
            question: question.slice(0, 500),
            toolsCalled: JSON.stringify(result.toolEvents.map((t) => t.name)),
            promptTokens: result.promptTokens,
            completionTokens: result.completionTokens,
            totalTokens: result.promptTokens + result.completionTokens,
            costSar,
            durationMs: Date.now() - started,
            provider: cfg.provider,
            model: effectiveModel(cfg),
            success: true,
          },
        })

        if (finished) {
          send({
            type: 'done',
            messageId: assistantMessage.id,
            promptTokens: result.promptTokens,
            completionTokens: result.completionTokens,
            costSar,
            toolsCalled: result.toolEvents.map((t) => t.name),
            title: title.title,
            drafts,
          })
        } else {
          send({
            type: 'done',
            messageId: assistantMessage.id,
            promptTokens: result.promptTokens,
            completionTokens: result.completionTokens,
            costSar,
            toolsCalled: [],
            title: title.title,
            drafts,
          })
        }
      } catch (e) {
        const message =
          e instanceof AbortError
            ? 'Stopped.'
            : e instanceof Error
              ? e.message
              : 'The AI assistant failed unexpectedly. The rest of the ERP keeps working normally.'
        if (e instanceof AbortError) {
          // persist whatever was generated? keep simple: mark a stopped note
          await db.aiChatMessage
            .create({
              data: {
                chatId,
                role: 'assistant',
                content: '_Stopped by user._',
                isError: false,
              },
            })
            .catch(() => {})
        } else {
          await saveError(chatId, user.id, user.name, question, message)
          await db.aiUsageLog
            .create({
              data: {
                userId: user.id,
                userName: user.name,
                chatId,
                question: question.slice(0, 500),
                durationMs: Date.now() - started,
                success: false,
                error: message.slice(0, 500),
              },
            })
            .catch(() => {})
        }
        send({ type: 'error', message })
      } finally {
        closed = true
        try {
          controller.close()
        } catch {
          // already closed
        }
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}

async function saveError(
  chatId: string,
  userId: string,
  userName: string,
  question: string,
  message: string
) {
  await db.aiChatMessage
    .create({
      data: { chatId, role: 'assistant', content: message, isError: true },
    })
    .catch(() => {})
  void userId
  void userName
  void question
}
