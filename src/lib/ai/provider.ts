// Server-only LLM provider abstraction for the AI Assistant.
// Providers: builtin (z-ai-web-dev-sdk GLM), zhipu, anthropic, openai.
// All calls are NON-STREAMING at the provider level — the chat route wraps
// results into SSE with server-paced reveal (the builtin SDK has no usable
// streaming; keeping one uniform path keeps behaviour identical everywhere).
import 'server-only'
import ZAI from 'z-ai-web-dev-sdk'
import type { AiProviderConfig } from './settings'
import { effectiveModel } from './settings'

export type ToolSpec = {
  type: 'function'
  function: { name: string; description: string; parameters: Record<string, unknown> }
}

export type ToolCall = {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

export type ChatMsg = {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | null
  tool_calls?: ToolCall[]
  tool_call_id?: string
}

export type LlmResult = {
  content: string
  toolCalls: ToolCall[]
  promptTokens: number
  completionTokens: number
}

export class ProviderError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ProviderError'
  }
}

/** One completion round with tool definitions (OpenAI wire format). */
export async function callLlm(opts: {
  cfg: AiProviderConfig
  messages: ChatMsg[]
  tools: ToolSpec[]
  maxTokens: number
}): Promise<LlmResult> {
  const { cfg, messages, tools, maxTokens } = opts
  switch (cfg.provider) {
    case 'builtin':
      return callBuiltin(messages, tools, maxTokens)
    case 'zhipu':
      return callOpenAiCompatible(
        cfg.baseUrl || 'https://open.bigmodel.cn/api/paas/v4/chat/completions',
        cfg.apiKey,
        effectiveModel(cfg),
        messages,
        tools,
        maxTokens
      )
    case 'openai':
      return callOpenAiCompatible(
        cfg.baseUrl || 'https://api.openai.com/v1/chat/completions',
        cfg.apiKey,
        effectiveModel(cfg),
        messages,
        tools,
        maxTokens
      )
    case 'anthropic':
      return callAnthropic(cfg, messages, tools, maxTokens)
    default:
      return callBuiltin(messages, tools, maxTokens)
  }
}

// ── builtin (sandbox GLM via z-ai-web-dev-sdk) ──────────────────────────────

let zaiPromise: Promise<Awaited<ReturnType<typeof ZAI.create>>> | null = null
function getZai() {
  if (!zaiPromise) zaiPromise = Promise.resolve(ZAI.create())
  return zaiPromise
}

async function callBuiltin(
  messages: ChatMsg[],
  tools: ToolSpec[],
  maxTokens: number
): Promise<LlmResult> {
  try {
    const zai = await getZai()
    const res = (await zai.chat.completions.create({
      messages: messages as never,
      ...(tools.length ? { tools: tools as never } : {}),
      max_tokens: maxTokens,
      thinking: { type: 'disabled' },
    } as never)) as {
      choices?: {
        message?: { content?: string | null; tool_calls?: ToolCall[] }
      }[]
      usage?: { prompt_tokens?: number; completion_tokens?: number }
    }
    const msg = res.choices?.[0]?.message
    return {
      content: msg?.content ?? '',
      toolCalls: msg?.tool_calls ?? [],
      promptTokens: res.usage?.prompt_tokens ?? 0,
      completionTokens: res.usage?.completion_tokens ?? 0,
    }
  } catch (e) {
    throw new ProviderError(
      `Built-in AI provider failed: ${e instanceof Error ? e.message : String(e)}. The rest of the ERP keeps working normally.`
    )
  }
}

// ── OpenAI-compatible (zhipu / openai) ──────────────────────────────────────

async function callOpenAiCompatible(
  url: string,
  apiKey: string | null,
  model: string,
  messages: ChatMsg[],
  tools: ToolSpec[],
  maxTokens: number
): Promise<LlmResult> {
  if (!apiKey) {
    throw new ProviderError(
      'No API key configured for this provider. Open Settings → AI Assistant and save the API key first.'
    )
  }
  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model, messages, tools, max_tokens: maxTokens }),
      signal: AbortSignal.timeout(120_000),
    })
  } catch (e) {
    throw new ProviderError(
      `Could not reach the AI provider (${e instanceof Error ? e.message : 'network error'}). Check the API base URL / network, or switch back to the built-in provider.`
    )
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new ProviderError(
      `AI provider error ${res.status}: ${body.slice(0, 300) || res.statusText}`
    )
  }
  const data = (await res.json()) as {
    choices?: { message?: { content?: string | null; tool_calls?: ToolCall[] } }[]
    usage?: { prompt_tokens?: number; completion_tokens?: number }
  }
  const msg = data.choices?.[0]?.message
  return {
    content: msg?.content ?? '',
    toolCalls: msg?.tool_calls ?? [],
    promptTokens: data.usage?.prompt_tokens ?? 0,
    completionTokens: data.usage?.completion_tokens ?? 0,
  }
}

// ── Anthropic (messages API, converted tool format) ─────────────────────────

type AnthropicBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string }

async function callAnthropic(
  cfg: AiProviderConfig,
  messages: ChatMsg[],
  tools: ToolSpec[],
  maxTokens: number
): Promise<LlmResult> {
  if (!cfg.apiKey) {
    throw new ProviderError(
      'No API key configured for Anthropic. Open Settings → AI Assistant and save the API key first.'
    )
  }
  const system = messages
    .filter((m) => m.role === 'system')
    .map((m) => m.content ?? '')
    .join('\n\n')
  const blocks: AnthropicBlock[] = []
  for (const m of messages) {
    if (m.role === 'system') continue
    if (m.role === 'user') {
      blocks.push({ type: 'text', text: m.content ?? '' })
    } else if (m.role === 'assistant') {
      if (m.content) blocks.push({ type: 'text', text: m.content })
      for (const tc of m.tool_calls ?? []) {
        blocks.push({
          type: 'tool_use',
          id: tc.id,
          name: tc.function.name,
          input: safeJson(tc.function.arguments),
        })
      }
    } else if (m.role === 'tool') {
      blocks.push({ type: 'tool_result', tool_use_id: m.tool_call_id ?? '', content: m.content ?? '' })
    }
  }
  const body = {
    model: effectiveModel(cfg),
    system,
    messages: [{ role: 'user', content: blocks }],
    max_tokens: maxTokens,
    ...(tools.length
      ? {
          tools: tools.map((t) => ({
            name: t.function.name,
            description: t.function.description,
            input_schema: t.function.parameters,
          })),
        }
      : {}),
  }
  let res: Response
  try {
    res = await fetch(cfg.baseUrl || 'https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': cfg.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120_000),
    })
  } catch (e) {
    throw new ProviderError(
      `Could not reach Anthropic (${e instanceof Error ? e.message : 'network error'}). The rest of the ERP keeps working normally.`
    )
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new ProviderError(`Anthropic error ${res.status}: ${text.slice(0, 300)}`)
  }
  const data = (await res.json()) as {
    content?: AnthropicBlock[]
    usage?: { input_tokens?: number; output_tokens?: number }
  }
  let content = ''
  const toolCalls: ToolCall[] = []
  for (const b of data.content ?? []) {
    if (b.type === 'text') content += b.text
    else if (b.type === 'tool_use') {
      toolCalls.push({
        id: b.id,
        type: 'function',
        function: { name: b.name, arguments: JSON.stringify(b.input ?? {}) },
      })
    }
  }
  return {
    content,
    toolCalls,
    promptTokens: data.usage?.input_tokens ?? 0,
    completionTokens: data.usage?.output_tokens ?? 0,
  }
}

function safeJson(s: string): Record<string, unknown> {
  try {
    return JSON.parse(s) as Record<string, unknown>
  } catch {
    return {}
  }
}

/** Quick connectivity test for the Settings page. */
export async function testProvider(cfg: AiProviderConfig): Promise<{ ok: boolean; message: string }> {
  try {
    const r = await callLlm({
      cfg,
      messages: [
        { role: 'system', content: 'Reply with exactly: OK' },
        { role: 'user', content: 'test' },
      ],
      tools: [],
      maxTokens: 16,
    })
    if (r.content.trim().length === 0 && r.completionTokens === 0) {
      return { ok: false, message: 'Provider responded with an empty answer.' }
    }
    return {
      ok: true,
      message: `Connection OK — model answered "${r.content.trim().slice(0, 40) || '(empty)'}" (${r.promptTokens}+${r.completionTokens} tokens).`,
    }
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : 'Unknown provider error',
    }
  }
}
