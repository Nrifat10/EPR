'use client'

// AI Assistant — full chat page: chat history sidebar (new / search /
// rename / delete) + chat thread with streaming answers, tool chips,
// markdown, drafts, charts, uploads, voice input and exports.
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  AlertTriangle,
  Check,
  MessageSquarePlus,
  Pencil,
  Search,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { PageHeader } from '@/components/app/shared/page-header'
import { useAppStore, can } from '@/lib/store'
import { formatDateTime } from '@/lib/format'
import { cn } from '@/lib/utils'
import { useAiChat } from '@/components/app/ai/use-ai-chat'
import { Composer } from '@/components/app/ai/composer'
import { MessageView, SuggestionChips } from '@/components/app/ai/message-view'
import { AiPreview } from '@/components/app/ai/markdown'
import type { AiChatSummary } from '@/lib/types'

export function AiAssistantView() {
  const { user, view } = useAppStore()
  const ai = useAiChat()
  const [draft, setDraft] = useState('')
  const [search, setSearch] = useState('')
  const [renaming, setRenaming] = useState<AiChatSummary | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [deleting, setDeleting] = useState<AiChatSummary | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const allowed = can(user, 'ai.use')

  // auto-scroll on new messages / deltas
  const lastLen = ai.messages[ai.messages.length - 1]?.content.length ?? 0
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 220
    if (nearBottom || ai.status !== 'idle') el.scrollTo({ top: el.scrollHeight })
  }, [ai.messages.length, lastLen, ai.status])

  // debounce history search
  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(() => void ai.refreshChats(search || undefined), 250)
    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current)
    }
  }, [search, ai.refreshChats])

  const send = useCallback(
    (text?: string) => {
      const q = (text ?? draft).trim()
      if (!q && ai.uploads.filter((u) => !u.error && !u.uploading).length === 0) return
      setDraft('')
      void ai.send(q)
    },
    [draft, ai]
  )

  if (!allowed) {
    return (
      <div className="space-y-4">
        <PageHeader title="AI Assistant" description="Conversational assistant for your ERP data" />
        <div className="flex items-center gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-6 text-sm text-destructive">
          <AlertTriangle className="h-5 w-5 shrink-0" />
          Your role does not include the “Use AI Assistant” permission. Ask an administrator to enable it in Roles &amp; Permissions.
        </div>
      </div>
    )
  }

  const empty = ai.messages.length === 0

  return (
    <div className="flex h-[calc(100svh-8.5rem)] flex-col gap-4 md:h-[calc(100svh-9.5rem)]">
      <PageHeader
        title="AI Assistant"
        description="Ask about employees, payroll, invoices, VAT, quotations — or anything else. Answers about ERP data come from live read-only tools."
      >
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            ai.newChat()
            setDraft('')
          }}
          className="gap-1.5"
        >
          <MessageSquarePlus className="h-4 w-4" /> New chat
        </Button>
      </PageHeader>

      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[280px_1fr]">
        {/* ── chat history column ── */}
        <aside className="hidden min-h-0 flex-col rounded-xl border bg-card shadow-sm lg:flex">
          <div className="border-b border-border/60 p-2.5">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search chats…"
                className="h-8 border-border/60 bg-muted/40 pl-8 text-xs"
              />
            </div>
          </div>
          <div className="nice-scrollbar min-h-0 flex-1 overflow-y-auto p-1.5">
            {ai.chats === null ? (
              <div className="space-y-2 p-1">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="h-12 animate-pulse rounded-lg bg-muted/50" />
                ))}
              </div>
            ) : ai.chats.length === 0 ? (
              <p className="px-3 py-6 text-center text-xs text-muted-foreground">
                {search ? 'No chats match your search.' : 'No chats yet — ask your first question!'}
              </p>
            ) : (
              ai.chats.map((c) => (
                <div
                  key={c.id}
                  className={cn(
                    'group relative cursor-pointer rounded-lg px-3 py-2 transition-colors',
                    ai.activeChatId === c.id
                      ? 'bg-primary text-primary-foreground shadow-sm'
                      : 'hover:bg-muted/70'
                  )}
                  onClick={() => void ai.openChat(c.id)}
                >
                  <div className="flex items-center gap-1.5 pr-14">
                    <Sparkles
                      className={cn(
                        'h-3 w-3 shrink-0',
                        ai.activeChatId === c.id ? 'text-gold' : 'text-gold-deep/70'
                      )}
                    />
                    <p className="truncate text-xs font-semibold">{c.title}</p>
                  </div>
                  <AiPreview
                    text={c.lastPreview}
                    className={cn(
                      'mt-0.5 block text-[10px]',
                      ai.activeChatId === c.id ? 'text-primary-foreground/70' : 'text-muted-foreground'
                    )}
                  />
                  <div className="absolute right-1.5 top-1.5 hidden gap-0.5 group-hover:flex">
                    <button
                      type="button"
                      className="rounded p-1 hover:bg-foreground/10"
                      title="Rename chat"
                      onClick={(e) => {
                        e.stopPropagation()
                        setRenaming(c)
                        setRenameValue(c.title)
                      }}
                    >
                      <Pencil className="h-3 w-3" />
                    </button>
                    <button
                      type="button"
                      className="rounded p-1 text-destructive hover:bg-destructive/10"
                      title="Delete chat"
                      onClick={(e) => {
                        e.stopPropagation()
                        setDeleting(c)
                      }}
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </aside>

        {/* ── chat thread ── */}
        <section className="flex min-h-0 flex-col overflow-hidden rounded-xl border bg-card shadow-sm">
          <div ref={scrollRef} className="nice-scrollbar min-h-0 flex-1 overflow-y-auto p-4 sm:p-5">
            {empty ? (
              <EmptyState onPick={(q) => send(q)} viewLabel={view} />
            ) : (
              <div className="space-y-5">
                {ai.messages.map((m) => (
                  <MessageView key={m.id} message={m} />
                ))}
              </div>
            )}
          </div>

          {/* status line */}
          {ai.status !== 'idle' ? (
            <div className="flex items-center gap-2 border-t border-border/50 px-4 py-1.5 text-[11px] text-muted-foreground">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-gold opacity-60" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-gold-deep" />
              </span>
              {ai.statusText || 'Working…'}
            </div>
          ) : null}

          <div className="border-t border-border/60 p-3 sm:p-4">
            {ai.error ? (
              <div className="mb-2 flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span className="min-w-0 flex-1">{ai.error}</span>
                <button type="button" onClick={() => ai.send('')} className="shrink-0 font-semibold underline">
                  Retry
                </button>
              </div>
            ) : null}
            <Composer
              value={draft}
              onChange={setDraft}
              onSend={() => send()}
              onStop={ai.stop}
              status={ai.status}
              uploads={ai.uploads}
              onFiles={(f) => void ai.addFiles(f)}
              onRemoveUpload={ai.removeUpload}
              autoFocus
            />
            <p className="mt-1.5 px-1 text-[10px] text-muted-foreground/70">
              AI answers about ERP data come from read-only tools — verify important figures before acting.
              Uploaded files are read for the conversation only, never saved into ERP records.
            </p>
          </div>
        </section>
      </div>

      {/* rename dialog */}
      {renaming ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-sm rounded-xl border bg-card p-4 shadow-lg">
            <p className="mb-2 text-sm font-semibold">Rename chat</p>
            <Input
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              maxLength={120}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter' && renameValue.trim()) {
                  void ai.renameChat(renaming.id, renameValue.trim())
                  setRenaming(null)
                }
              }}
            />
            <div className="mt-3 flex justify-end gap-2">
              <Button size="sm" variant="outline" onClick={() => setRenaming(null)}>
                Cancel
              </Button>
              <Button
                size="sm"
                disabled={!renameValue.trim()}
                onClick={() => {
                  void ai.renameChat(renaming.id, renameValue.trim())
                  setRenaming(null)
                }}
              >
                <Check className="mr-1 h-3.5 w-3.5" /> Save
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {/* delete confirm */}
      <AlertDialog open={Boolean(deleting)} onOpenChange={(v) => !v && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this chat?</AlertDialogTitle>
            <AlertDialogDescription>
              “{deleting?.title}” and all its messages will be permanently removed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (deleting) {
                  void ai.deleteChat(deleting.id)
                  toast.success('Chat deleted')
                }
                setDeleting(null)
              }}
            >
              <Trash2 className="mr-1.5 h-4 w-4" /> Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function EmptyState({ onPick, viewLabel }: { onPick: (q: string) => void; viewLabel: string }) {
  return (
    <div className="flex h-full min-h-64 flex-col items-center justify-center gap-5 p-4 text-center">
      <div className="relative">
        <div className="absolute inset-0 rounded-2xl bg-gold/20 blur-xl" aria-hidden />
        <div className="relative flex h-16 w-16 items-center justify-center rounded-2xl bg-gold-soft ring-1 ring-gold/40">
          <Sparkles className="h-8 w-8 text-gold-deep" />
        </div>
      </div>
      <div>
        <h2 className="text-lg font-bold">How can I help you today?</h2>
        <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
          Ask in English, Arabic or Bangla. I can answer from your live ERP data —
          workers, sites, payroll, invoices, VAT, quotations, POs — or help with general
          questions, translations and drafts.
        </p>
      </div>
      <SuggestionChips onPick={onPick} />
      <p className="text-[10px] text-muted-foreground/60">
        Currently viewing: {viewLabel} · the assistant knows which page you are on
      </p>
    </div>
  )
}

export { formatDateTime, X }
