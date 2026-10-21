'use client'

// Shared AI chat engine — one hook powering BOTH the full AI Assistant page
// and the floating side panel. Consumes the SSE agent endpoint with a
// stoppable fetch, manages messages, chats, uploads and page context.
import { useCallback, useEffect, useRef, useState } from 'react'
import { getAuthToken } from '@/lib/api-client'
import { useAppStore } from '@/lib/store'
import { VIEW_LABELS, type AiAttachmentMeta, type AiChatSummary, type AiDraft, type AiMessage, type AiToolEvent } from '@/lib/types'

export type PendingUpload = {
  name: string
  mime: string
  size: number
  text: string
  uploading: boolean
  error?: string
}

export type StreamStatus = 'idle' | 'connecting' | 'thinking' | 'writing' | 'error'

export function useAiChat(opts?: { chatId?: string | null }) {
  const { view, user } = useAppStore()
  const [chats, setChats] = useState<AiChatSummary[] | null>(null)
  const [activeChatId, setActiveChatId] = useState<string | null>(opts?.chatId ?? null)
  const [messages, setMessages] = useState<AiMessage[]>([])
  const [status, setStatus] = useState<StreamStatus>('idle')
  const [statusText, setStatusText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [uploads, setUploads] = useState<PendingUpload[]>([])
  const abortRef = useRef<AbortController | null>(null)
  const activeIdRef = useRef<string | null>(opts?.chatId ?? null)
  activeIdRef.current = activeChatId

  // ── load chat list ──
  const refreshChats = useCallback(async (q?: string) => {
    try {
      const token = getAuthToken()
      const res = await fetch(`/api/ai/chats${q ? `?q=${encodeURIComponent(q)}` : ''}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        cache: 'no-store',
      })
      if (res.ok) {
        const data = (await res.json()) as { chats: AiChatSummary[] }
        setChats(data.chats)
      }
    } catch {
      // offline tolerance — keep old list
    }
  }, [])

  useEffect(() => {
    void refreshChats()
  }, [refreshChats])

  // ── open a chat (loads messages) ──
  const openChat = useCallback(async (id: string) => {
    abortRef.current?.abort()
    setStatus('idle')
    setError(null)
    setActiveChatId(id)
    setMessages([])
    try {
      const token = getAuthToken()
      const res = await fetch(`/api/ai/chats/${id}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        cache: 'no-store',
      })
      if (!res.ok) throw new Error('Chat not found')
      const data = (await res.json()) as {
        chat: {
          id: string
          messages: {
            id: string
            role: string
            content: string
            toolEvents: string
            attachments: string
            drafts: string
            promptTokens: number
            completionTokens: number
            isError: boolean
            createdAt: string
          }[]
        }
      }
      if (activeIdRef.current !== id) return
      setMessages(
        data.chat.messages.map((m) => ({
          id: m.id,
          role: m.role === 'user' ? 'user' : 'assistant',
          content: m.content,
          toolEvents: safeParse<AiToolEvent[]>(m.toolEvents, []),
          attachments: safeParse<AiAttachmentMeta[]>(m.attachments, []),
          drafts: safeParse<AiDraft[]>(m.drafts, []),
          promptTokens: m.promptTokens,
          completionTokens: m.completionTokens,
          isError: m.isError,
          createdAt: m.createdAt,
        }))
      )
    } catch {
      setError('Could not load this chat.')
    }
  }, [])

  const newChat = useCallback(() => {
    abortRef.current?.abort()
    setActiveChatId(null)
    setMessages([])
    setStatus('idle')
    setError(null)
    setUploads([])
  }, [])

  // ── send a message (SSE) ──
  const send = useCallback(
    async (question: string) => {
      if (status === 'connecting' || status === 'thinking' || status === 'writing') return
      const files = uploads.filter((u) => !u.error)
      if (!question.trim() && files.length === 0) return
      setError(null)
      setStatus('connecting')
      setStatusText('Connecting…')

      const tempUserId = `tmp-u-${Date.now()}`
      const tempAssistantId = `tmp-a-${Date.now()}`
      setMessages((prev) => [
        ...prev,
        {
          id: tempUserId,
          role: 'user',
          content: question.trim() || `(uploaded ${files.map((f) => f.name).join(', ')})`,
          toolEvents: [],
          attachments: files.map((f) => ({
            name: f.name,
            type: f.mime,
            size: f.size,
            extractedChars: f.text.length,
          })),
          drafts: [],
          promptTokens: 0,
          completionTokens: 0,
          isError: false,
          createdAt: new Date().toISOString(),
        },
        {
          id: tempAssistantId,
          role: 'assistant',
          content: '',
          toolEvents: [],
          attachments: [],
          drafts: [],
          promptTokens: 0,
          completionTokens: 0,
          isError: false,
          createdAt: new Date().toISOString(),
          streaming: true,
        },
      ])
      setUploads([])

      const ac = new AbortController()
      abortRef.current = ac
      const token = getAuthToken()
      try {
        const res = await fetch('/api/ai/chat', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({
            chatId: activeIdRef.current,
            message: question.trim(),
            attachments: files.map((f) => ({
              name: f.name,
              mime: f.mime,
              size: f.size,
              text: f.text,
            })),
            pageContext: {
              view,
              viewLabel: VIEW_LABELS[view] ?? view,
              recordLabel: null,
            },
          }),
          signal: ac.signal,
        })
        if (!res.ok || !res.body) {
          const data = (await res.json().catch(() => null)) as { error?: string } | null
          throw new Error(data?.error ?? `Request failed (${res.status})`)
        }

        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let buf = ''
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          buf += decoder.decode(value, { stream: true })
          const parts = buf.split('\n\n')
          buf = parts.pop() ?? ''
          for (const part of parts) {
            const line = part.trim()
            if (!line.startsWith('data: ')) continue
            let ev: Record<string, unknown>
            try {
              ev = JSON.parse(line.slice(6)) as Record<string, unknown>
            } catch {
              continue
            }
            handleEvent(ev, {
              tempAssistantId,
              setActiveChatId,
              setMessages,
              setStatus,
              setStatusText,
              setError,
              refreshChats,
            })
          }
        }
      } catch (e) {
        if ((e as Error).name === 'AbortError') {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === tempAssistantId
                ? {
                    ...m,
                    streaming: false,
                    content: m.content || '_Stopped._',
                  }
                : m
            )
          )
        } else {
          const msg = e instanceof Error ? e.message : 'The assistant failed to answer.'
          setError(msg)
          setMessages((prev) =>
            prev.map((m) =>
              m.id === tempAssistantId ? { ...m, streaming: false, isError: true, content: msg } : m
            )
          )
        }
      } finally {
        setStatus((s) => (s === 'idle' ? s : 'idle'))
        setStatusText('')
        abortRef.current = null
      }
    },
    [uploads, status, view, refreshChats]
  )

  const stop = useCallback(() => {
    abortRef.current?.abort()
  }, [])

  // ── chat management ──
  const renameChat = useCallback(
    async (id: string, title: string) => {
      const token = getAuthToken()
      await fetch(`/api/ai/chats/${id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ title }),
      }).catch(() => {})
      await refreshChats()
    },
    [refreshChats]
  )

  const deleteChat = useCallback(
    async (id: string) => {
      const token = getAuthToken()
      await fetch(`/api/ai/chats/${id}`, {
        method: 'DELETE',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      }).catch(() => {})
      if (activeIdRef.current === id) {
        setActiveChatId(null)
        setMessages([])
      }
      await refreshChats()
    },
    [refreshChats]
  )

  // ── file upload ──
  const addFiles = useCallback(async (files: File[]) => {
    for (const file of files.slice(0, 4)) {
      const key = `${file.name}-${file.size}-${Date.now()}`
      setUploads((prev) => [
        ...prev,
        { name: file.name, mime: file.type || 'application/octet-stream', size: file.size, text: '', uploading: true },
      ])
      try {
        const fd = new FormData()
        fd.append('file', file)
        const token = getAuthToken()
        const res = await fetch('/api/ai/upload', {
          method: 'POST',
          body: fd,
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        })
        const data = (await res.json().catch(() => ({}))) as {
          text?: string
          error?: string
        }
        setUploads((prev) =>
          prev.map((u) =>
            u.name === file.name && u.size === file.size
              ? {
                  ...u,
                  uploading: false,
                  text: data.text ?? '',
                  error: res.ok ? undefined : data.error ?? 'Upload failed',
                }
              : u
          )
        )
      } catch {
        setUploads((prev) =>
          prev.map((u) =>
            u.name === file.name && u.size === file.size
              ? { ...u, uploading: false, error: 'Upload failed' }
              : u
          )
        )
      }
      void key
    }
  }, [])

  const removeUpload = useCallback((name: string) => {
    setUploads((prev) => prev.filter((u) => u.name !== name))
  }, [])

  const canUse = Boolean(user)

  return {
    chats,
    activeChatId,
    messages,
    status,
    statusText,
    error,
    uploads,
    canUse,
    send,
    stop,
    openChat,
    newChat,
    renameChat,
    deleteChat,
    refreshChats,
    addFiles,
    removeUpload,
    setActiveChatId,
  }
}

// ── SSE event application ───────────────────────────────────────────────────

type Handlers = {
  tempAssistantId: string
  setActiveChatId: (id: string) => void
  setMessages: React.Dispatch<React.SetStateAction<AiMessage[]>>
  setStatus: (s: StreamStatus) => void
  setStatusText: (t: string) => void
  setError: (e: string | null) => void
  refreshChats: () => Promise<void>
}

function handleEvent(ev: Record<string, unknown>, h: Handlers) {
  const type = ev.type as string
  if (type === 'meta') {
    const chatId = ev.chatId as string
    h.setActiveChatId(chatId)
  } else if (type === 'status') {
    const text = ev.text as string
    h.setStatusText(text)
    h.setStatus(text.toLowerCase().includes('writing') ? 'writing' : 'thinking')
  } else if (type === 'tool') {
    const event = ev.event as AiToolEvent
    h.setMessages((prev) =>
      prev.map((m) =>
        m.id === h.tempAssistantId
          ? { ...m, toolEvents: [...m.toolEvents, event] }
          : m
      )
    )
  } else if (type === 'delta') {
    const text = ev.text as string
    h.setMessages((prev) =>
      prev.map((m) => (m.id === h.tempAssistantId ? { ...m, content: m.content + text } : m))
    )
  } else if (type === 'done') {
    const messageId = ev.messageId as string
    const drafts = (ev.drafts as AiDraft[] | undefined) ?? []
    h.setMessages((prev) =>
      prev.map((m) =>
        m.id === h.tempAssistantId
          ? {
              ...m,
              id: messageId,
              streaming: false,
              drafts: drafts.length ? drafts : m.drafts,
              promptTokens: (ev.promptTokens as number) ?? 0,
              completionTokens: (ev.completionTokens as number) ?? 0,
            }
          : m
      )
    )
    void h.refreshChats()
  } else if (type === 'error') {
    const message = ev.message as string
    h.setError(message)
    h.setMessages((prev) =>
      prev.map((m) =>
        m.id === h.tempAssistantId
          ? { ...m, streaming: false, isError: true, content: m.content || message }
          : m
      )
    )
  }
}

function safeParse<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}
