// Server-only AI agent: tool-calling loop + SSE event writer.
// Loop: user question → LLM (with visible ERP tools) → execute tools →
// feed results back → final markdown answer. Draft/chart blocks are parsed
// out of the final answer and persisted with the message.
import 'server-only'
import { db } from '@/lib/db'
import { getAiProviderConfig, effectiveModel } from './settings'
import { callLlm, type ChatMsg, type ToolCall, ProviderError } from './provider'
import { buildSystemPrompt, type PageContext } from './prompt'
import { getTool, toolSpecsFor, payrollAllowed, type ToolEvent } from './tools'
import type { SessionUser } from '@/lib/types'

export const MAX_ROUNDS = 8
const HISTORY_TURNS = 16 // previous user+assistant messages replayed for context
const ATTACHMENT_CHAR_CAP = 14_000

export type SseEvent =
  | { type: 'meta'; chatId: string; userMessageId: string; assistantMessageId?: string }
  | { type: 'status'; text: string }
  | { type: 'tool'; event: ToolEvent }
  | { type: 'delta'; text: string }
  | {
      type: 'done'
      messageId: string
      promptTokens: number
      completionTokens: number
      costSar: number
      toolsCalled: string[]
      title: string
      drafts?: { type: string; title: string; data: Record<string, unknown> }[]
    }
  | { type: 'error'; message: string }

export type Attachment = {
  name: string
  mime: string
  size: number
  text: string // extracted content (server-side extraction at upload time)
}

export type RunResult = {
  answer: string
  toolEvents: ToolEvent[]
  drafts: { type: string; title: string; data: Record<string, unknown> }[]
  promptTokens: number
  completionTokens: number
}

/** Extract ```draft:TYPE {json}``` blocks from a markdown answer. */
export function extractDrafts(answer: string): {
  cleaned: string
  drafts: { type: string; title: string; data: Record<string, unknown> }[]
} {
  const drafts: { type: string; title: string; data: Record<string, unknown> }[] = []
  const re = /```draft:(quotation|invoice|po|email|letter)\s*\n([\s\S]*?)```/g
  const cleaned = answer.replace(re, (_m, type: string, body: string) => {
    try {
      const data = JSON.parse(body.trim()) as Record<string, unknown>
      const title =
        typeof data.subject === 'string'
          ? data.subject
          : typeof data.title === 'string'
            ? data.title
            : DRAFT_TITLES[type] ?? 'Draft'
      drafts.push({ type, title, data })
      return `%%DRAFT:${drafts.length - 1}%%`
    } catch {
      return _m // leave malformed blocks visible
    }
  })
  return { cleaned, drafts }
}

export const DRAFT_TITLES: Record<string, string> = {
  quotation: 'Draft Quotation',
  invoice: 'Draft Invoice',
  po: 'Draft Purchase Order',
  email: 'Draft Email',
  letter: 'Draft Letter',
}

/**
 * Run the agent loop. `send` receives SSE events as they happen; `aborted`
 * is polled between rounds (fetch abort → stop the loop cleanly).
 */
export async function runAgent(opts: {
  user: SessionUser
  question: string
  attachments?: Attachment[]
  page?: PageContext | null
  history?: { role: string; content: string }[]
  send: (e: SseEvent) => void
  aborted: () => boolean
}): Promise<RunResult> {
  const cfg = await getAiProviderConfig()
  const specs = toolSpecsFor(opts.user)

  // ── build message list ──
  const system = buildSystemPrompt({
    user: opts.user,
    toolNames: specs.map((s) => s.function.name),
    payrollAllowed: payrollAllowed(opts.user),
    page: opts.page ?? null,
    today: new Date(),
  })

  let userContent = opts.question
  for (const a of opts.attachments ?? []) {
    const text = a.text.slice(0, ATTACHMENT_CHAR_CAP)
    userContent += `\n\n--- Attached file: ${a.name} (${a.mime}, ${Math.round(a.size / 1024)} KB) ---\n${text}`
  }

  const messages: ChatMsg[] = [{ role: 'system', content: system }]
  for (const h of (opts.history ?? []).slice(-HISTORY_TURNS)) {
    if (h.role === 'user' || h.role === 'assistant') {
      messages.push({ role: h.role, content: h.content })
    }
  }
  messages.push({ role: 'user', content: userContent })

  const toolEvents: ToolEvent[] = []
  let promptTokens = 0
  let completionTokens = 0
  let corrected = false

  for (let round = 0; round < MAX_ROUNDS; round++) {
    if (opts.aborted()) throw new AbortError()

    let result
    try {
      result = await callLlm({ cfg, messages, tools: specs, maxTokens: cfg.maxTokens })
    } catch (e) {
      if (e instanceof ProviderError) throw e
      throw new ProviderError(
        `AI provider failed: ${e instanceof Error ? e.message : String(e)}`
      )
    }
    promptTokens += result.promptTokens
    completionTokens += result.completionTokens

    // ── tool calls? execute and loop ──
    if (result.toolCalls.length > 0) {
      messages.push({
        role: 'assistant',
        content: result.content || '',
        tool_calls: result.toolCalls,
      })
      for (const tc of result.toolCalls) {
        const ev = await executeTool(opts.user, tc)
        toolEvents.push(ev)
        opts.send({ type: 'tool', event: ev })
        messages.push({
          role: 'tool',
          tool_call_id: tc.id,
          content: JSON.stringify(ev.result).slice(0, 30_000),
        })
      }
      continue
    }

    // ── final answer ──
    const answer = result.content.trim()
    if (!answer && round === 0) {
      throw new ProviderError('The AI returned an empty answer. Please try again.')
    }
    if (!answer) break

    // ── anti-hallucination guard ──
    // A data-looking question answered with ZERO tool calls is untrustworthy
    // (the model may have invented numbers). Force one corrective round.
    // Skipped for attachment questions — their data lives in the message text.
    const hasAttachments = (opts.attachments?.length ?? 0) > 0
    if (
      toolEvents.length === 0 &&
      !hasAttachments &&
      looksLikeDataQuestion(opts.question) &&
      !corrected
    ) {
      corrected = true
      messages.push({ role: 'assistant', content: answer })
      messages.push({
        role: 'user',
        content:
          'STOP — CORRECTION REQUIRED. Your previous answer discussed company data but you called no ERP tool, so its figures cannot be trusted. Call the appropriate ERP tool(s) NOW, then rewrite the answer using ONLY the tool results. If the question is about an ATTACHED FILE, its full contents are already quoted inside the user message above the line "--- Attached file: ... ---" — answer directly from that text instead of calling tools. If you lack the tool for this data (e.g. payroll), refuse politely and suggest contacting an Admin / Accounts role. If the tools return no data, say clearly that no matching data was found. Never invent names, numbers or dates. Do NOT mention this correction message or your previous attempt — reply as a clean, direct answer.',
      })
      continue
    }

    const cost = estimateCost(cfg.inCostPer1k, cfg.outCostPer1k, promptTokens, completionTokens)
    void cost
    return {
      answer,
      toolEvents,
      drafts: extractDrafts(answer).drafts,
      promptTokens,
      completionTokens,
    }
  }

  throw new ProviderError(
    `The assistant could not finish after ${MAX_ROUNDS} tool rounds. Please rephrase the question.`
  )
}

export class AbortError extends Error {
  constructor() {
    super('Stopped by user')
    this.name = 'AbortError'
  }
}

// ── anti-hallucination heuristic ────────────────────────────────────────────
// Words that imply the question is about ERP data (EN + Banglish + Bangla +
// Arabic transliterations). If matched and NO tool was called, the agent
// forces a corrective round instead of trusting a from-memory answer.
const DATA_WORDS = [
  // workforce
  'worker', 'workers', 'employee', 'employees', 'staff', 'manpower', 'site',
  'sites', 'project', 'projects', 'deploy', 'deployment', 'trade',
  'iqama', 'iqama', 'iqamar', 'muqama', 'id expiry', 'passport',
  'karmi', 'kajer', 'lok', 'jon kaj',
  // money / accounts
  'invoice', 'invoices', 'inv-', 'unpaid', 'overdue', 'receivable', 'aging',
  'quotation', 'quotations', 'quote', 'qtn', 'purchase order', 'po ',
  'supplier', 'suppliers', 'client', 'clients', 'customer', 'customers',
  'payroll', 'salary', 'salaries', 'wage', 'wages', 'advance', 'advances',
  'vat', 'tax', 'zatca', 'expense', 'expenses', 'spending', 'income',
  'attendance', 'hours', 'check-in', 'checkin',
  // banglish / bangla
  'koto', 'kotojon', 'baki', 'bill', 'taka', 'beshi', 'site e',
  'kor', 'kore', 'kon', 'kar', 'kake', 'month e', 'mas e', 'mashey',
]

export function looksLikeDataQuestion(question: string): boolean {
  const q = ` ${question.toLowerCase()} `
  return DATA_WORDS.some((w) => q.includes(w))
}

async function executeTool(user: SessionUser, tc: ToolCall): Promise<ToolEvent & { result: unknown }> {
  const started = Date.now()
  const name = tc.function.name
  const tool = getTool(name)
  let args: Record<string, unknown> = {}
  try {
    args = JSON.parse(tc.function.arguments || '{}') as Record<string, unknown>
  } catch {
    args = {}
  }
  if (!tool) {
    return {
      name,
      args,
      ok: false,
      ms: 0,
      error: `Unknown tool "${name}"`,
      result: { error: `Unknown tool "${name}".` },
    }
  }
  try {
    const result = await tool.run({ user }, args)
    const rows =
      typeof result === 'object' && result !== null && 'count' in result
        ? Number((result as { count: number }).count)
        : typeof result === 'object' && result !== null && 'employees' in result
          ? Array.isArray((result as { employees: unknown[] }).employees)
            ? (result as { employees: unknown[] }).employees.length
            : 0
          : undefined
    return {
      name,
      args,
      ok: true,
      ms: Date.now() - started,
      rows,
      summary: describeResult(result),
      result,
    }
  } catch (e) {
    return {
      name,
      args,
      ok: false,
      ms: Date.now() - started,
      error: e instanceof Error ? e.message : 'Tool failed',
      result: { error: e instanceof Error ? e.message : 'Tool failed' },
    }
  }
}

function describeResult(r: unknown): string | undefined {
  if (typeof r !== 'object' || r === null) return undefined
  const o = r as Record<string, unknown>
  if (typeof o.count === 'number') return `${o.count} record(s)`
  if (Array.isArray(o.employees)) return `${o.employees.length} worker(s)`
  if (Array.isArray(o.sites)) return `${o.sites.length} site(s)`
  if (typeof o.totalOutstanding === 'number') return `aging computed`
  return undefined
}

export function estimateCost(
  inPer1k: number,
  outPer1k: number,
  promptTokens: number,
  completionTokens: number
): number {
  return (
    Math.round(((promptTokens / 1000) * inPer1k + (completionTokens / 1000) * outPer1k) * 10000) /
    10000
  )
}

/** Server-paced reveal of the final answer as SSE deltas. */
export async function streamAnswer(
  text: string,
  send: (e: SseEvent) => void,
  aborted: () => boolean
): Promise<boolean> {
  const pieces = text.match(/\S+\s*|\s+/g) ?? [text]
  const GROUP = 3 // words per delta
  for (let i = 0; i < pieces.length; i += GROUP) {
    if (aborted()) return false
    send({ type: 'delta', text: pieces.slice(i, i + GROUP).join('') })
    await new Promise((r) => setTimeout(r, 14))
  }
  return true
}

/** Derive a chat title from the first user message. */
export function deriveTitle(question: string): string {
  const t = question.replace(/\s+/g, ' ').trim()
  return t.length > 48 ? `${t.slice(0, 45)}…` : t || 'New chat'
}

export { effectiveModel }
