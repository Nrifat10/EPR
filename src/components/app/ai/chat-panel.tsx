'use client'

// Floating AI button + side panel — available on EVERY page (bottom-right).
// Opens a Sheet chat drawer that knows the current page (view context), so
// you can ask "explain this page" while looking at it. Hidden on the full
// AI Assistant page itself.
import { useEffect, useRef, useState } from 'react'
import { Bot, Maximize2, Sparkles, X } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet'
import { useAppStore, can } from '@/lib/store'
import { VIEW_LABELS } from '@/lib/types'
import { cn } from '@/lib/utils'
import { useAiChat } from './use-ai-chat'
import { Composer } from './composer'
import { MessageView, SuggestionChips } from './message-view'

export function AiChatPanel() {
  const { user, view, setView } = useAppStore()
  const [open, setOpen] = useState(false)
  const ai = useAiChat()
  const [draft, setDraft] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)
  const allowed = can(user, 'ai.use')
  const onAiPage = view === 'ai-assistant'

  const lastLen = ai.messages[ai.messages.length - 1]?.content.length ?? 0
  useEffect(() => {
    const el = scrollRef.current
    if (!el || !open) return
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 200
    if (nearBottom || ai.status !== 'idle') el.scrollTo({ top: el.scrollHeight })
  }, [ai.messages.length, lastLen, ai.status, open])

  if (!allowed || onAiPage) return null

  const busy = ai.status !== 'idle'
  const empty = ai.messages.length === 0

  const send = (text?: string) => {
    const q = (text ?? draft).trim()
    if (!q && ai.uploads.filter((u) => !u.error && !u.uploading).length === 0) return
    setDraft('')
    void ai.send(q)
  }

  return (
    <>
      {/* floating button */}
      <AnimatePresence>
        <motion.button
          type="button"
          onClick={() => setOpen(true)}
          initial={{ scale: 0, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ delay: 0.4, type: 'spring', stiffness: 260, damping: 18 }}
          className={cn(
            'group fixed bottom-5 right-5 z-40 flex h-14 w-14 items-center justify-center rounded-2xl',
            'bg-primary text-primary-foreground shadow-lg shadow-primary/30 ring-1 ring-gold/50',
            'transition-transform hover:scale-105 active:scale-95'
          )}
          aria-label="Open AI Assistant"
          title="AI Assistant — ask about this page"
          style={{ bottom: 'max(1.25rem, env(safe-area-inset-bottom))' }}
        >
          <Sparkles className="h-6 w-6 text-gold transition-transform group-hover:rotate-12" />
          {busy ? (
            <span className="absolute -right-0.5 -top-0.5 flex h-4 w-4">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-gold opacity-75" />
              <span className="relative inline-flex h-4 w-4 rounded-full border-2 border-primary bg-gold" />
            </span>
          ) : null}
        </motion.button>
      </AnimatePresence>

      {/* side panel */}
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          side="right"
          className="flex w-[100vw] flex-col gap-0 p-0 sm:w-[440px]"
        >
          <SheetHeader className="border-b border-border/60 bg-gradient-to-b from-gold-soft/60 to-transparent px-4 py-3">
            <div className="flex items-center gap-2.5">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gold-soft ring-1 ring-gold/40">
                <Bot className="h-5 w-5 text-gold-deep" />
              </span>
              <div className="min-w-0 flex-1">
                <SheetTitle className="text-sm">AI Assistant</SheetTitle>
                <SheetDescription className="truncate text-[11px]">
                  Viewing: {VIEW_LABELS[view] ?? view} — ask about this page
                </SheetDescription>
              </div>
              <button
                type="button"
                onClick={() => {
                  setOpen(false)
                  setView('ai-assistant')
                }}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                title="Open full AI Assistant page"
                aria-label="Open full AI Assistant page"
              >
                <Maximize2 className="h-4 w-4" />
              </button>
            </div>
          </SheetHeader>

          {/* messages */}
          <div ref={scrollRef} className="nice-scrollbar min-h-0 flex-1 overflow-y-auto px-3 py-4">
            {empty ? (
              <div className="flex h-full flex-col items-center justify-center gap-4 p-3 text-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gold-soft ring-1 ring-gold/40">
                  <Sparkles className="h-6 w-6 text-gold-deep" />
                </div>
                <p className="text-sm text-muted-foreground">
                  Quick questions about <strong>{VIEW_LABELS[view] ?? view}</strong> — or anything else.
                </p>
                <SuggestionChips onPick={(q) => send(q)} />
              </div>
            ) : (
              <div className="space-y-4">
                {ai.messages.map((m) => (
                  <MessageView key={m.id} message={m} compact />
                ))}
              </div>
            )}
          </div>

          {/* composer */}
          <div className="border-t border-border/60 p-3">
            {ai.error ? (
              <p className="mb-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-1.5 text-[11px] text-destructive">
                {ai.error}
              </p>
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
              placeholder="Ask about this page…"
              autoFocus={open}
            />
          </div>
        </SheetContent>
      </Sheet>
    </>
  )
}

export { X }
