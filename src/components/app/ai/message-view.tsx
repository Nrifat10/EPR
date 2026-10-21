'use client'

// One chat message: user bubble (right, navy) / assistant card (left, with
// tool-call chips, markdown answer, copy + export actions, token footprint).
import { useState } from 'react'
import {
  AlertTriangle,
  Bot,
  Check,
  ClipboardCopy,
  Coins,
  FileDown,
  FileSpreadsheet,
  Loader2,
  Paperclip,
  Sparkles,
  User,
  Wrench,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import type { AiMessage } from '@/lib/types'
import { cn } from '@/lib/utils'
import { formatDateTime } from '@/lib/format'
import { AiMarkdown } from './markdown'
import { copyText, exportAnswerToExcel, printAnswer, extractTables } from './export-helpers'

export function MessageView({
  message,
  compact,
}: {
  message: AiMessage
  compact?: boolean // side-panel mode
}) {
  const [copied, setCopied] = useState(false)
  const isUser = message.role === 'user'

  if (isUser) {
    return (
      <div className="flex justify-end gap-2.5">
        <div className="max-w-[85%] sm:max-w-[75%]">
          <div className="rounded-2xl rounded-br-md border border-primary/20 bg-primary px-4 py-2.5 text-sm text-primary-foreground shadow-sm">
            <p className="whitespace-pre-wrap break-words leading-relaxed">{message.content}</p>
          </div>
          {message.attachments.length > 0 ? (
            <div className="mt-1 flex flex-wrap justify-end gap-1">
              {message.attachments.map((a) => (
                <span
                  key={a.name}
                  className="inline-flex items-center gap-1 rounded-full border border-border/70 bg-muted/60 px-2 py-0.5 text-[10px] text-muted-foreground"
                >
                  <Paperclip className="h-2.5 w-2.5" />
                  {a.name}
                  {a.extractedChars ? ` · ${a.extractedChars.toLocaleString()} chars read` : ''}
                </span>
              ))}
            </div>
          ) : null}
        </div>
        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm">
          <User className="h-4 w-4" />
        </span>
      </div>
    )
  }

  // assistant
  const hasContent = message.content.trim().length > 0
  return (
    <div className="flex gap-2.5">
      <span
        className={cn(
          'mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full shadow-sm ring-1 ring-gold/40',
          message.isError ? 'bg-destructive text-destructive-foreground' : 'bg-gold-soft text-gold-deep'
        )}
      >
        {message.isError ? <AlertTriangle className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
      </span>
      <div className="min-w-0 max-w-[92%] flex-1">
        {/* tool call chips */}
        {message.toolEvents.length > 0 ? (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {message.toolEvents.map((t, i) => (
              <TooltipHeader key={i} event={t} />
            ))}
          </div>
        ) : null}

        {hasContent ? (
          <div
            className={cn(
              'rounded-2xl rounded-tl-md border bg-card px-4 py-3 text-sm shadow-sm',
              message.isError ? 'border-destructive/40 bg-destructive/5' : 'border-border/70'
            )}
          >
            <AiMarkdown content={message.content} drafts={message.drafts} streaming={message.streaming} />
          </div>
        ) : message.streaming ? (
          <div className="inline-flex items-center gap-2 rounded-2xl rounded-tl-md border border-border/70 bg-card px-4 py-3 text-sm text-muted-foreground shadow-sm">
            <Loader2 className="h-3.5 w-3.5 animate-spin text-gold-deep" />
            Working…
          </div>
        ) : null}

        {/* actions */}
        {!message.streaming && hasContent ? (
          <div className="mt-1 flex flex-wrap items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1 px-2 text-[11px] text-muted-foreground"
              onClick={async () => {
                const ok = await copyText(message.content)
                if (ok) {
                  setCopied(true)
                  setTimeout(() => setCopied(false), 1500)
                }
              }}
            >
              {copied ? <Check className="h-3 w-3 text-emerald-600" /> : <ClipboardCopy className="h-3 w-3" />}
              {copied ? 'Copied' : 'Copy'}
            </Button>
            {extractTables(message.content).length > 0 ? (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 gap-1 px-2 text-[11px] text-muted-foreground"
                onClick={async () => {
                  const ok = await exportAnswerToExcel('AI Answer', message.content)
                  if (!ok) toast.error('No tables found to export')
                }}
              >
                <FileSpreadsheet className="h-3 w-3" /> Excel
              </Button>
            ) : null}
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1 px-2 text-[11px] text-muted-foreground"
              onClick={() => {
                const ok = printAnswer('AI Assistant answer', message.content)
                if (!ok) toast.error('Please allow pop-ups to export as PDF')
              }}
            >
              <FileDown className="h-3 w-3" /> PDF
            </Button>
            {message.completionTokens > 0 && !compact ? (
              <span className="ml-1 inline-flex items-center gap-1 text-[10px] text-muted-foreground/70">
                <Coins className="h-3 w-3" />
                {message.promptTokens.toLocaleString()} + {message.completionTokens.toLocaleString()} tokens
              </span>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  )
}

function TooltipHeader({ event }: { event: AiMessage['toolEvents'][number] }) {
  const [open, setOpen] = useState(false)
  return (
    <Tooltip open={open} onOpenChange={setOpen}>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className={cn(
            'inline-flex max-w-56 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors',
            event.ok
              ? 'border-gold/40 bg-gold-soft/70 text-gold-deep hover:border-gold'
              : 'border-destructive/40 bg-destructive/10 text-destructive'
          )}
        >
          <Wrench className="h-3 w-3 shrink-0" />
          <span className="truncate font-mono">{event.name}</span>
          {event.ok ? (
            <span className="shrink-0 text-[10px] text-muted-foreground">
              {event.rows !== undefined ? `${event.rows} rows` : '✓'}
              {event.ms ? ` · ${event.ms}ms` : ''}
            </span>
          ) : (
            <span className="shrink-0 text-[10px]">failed</span>
          )}
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-80">
        <p className="mb-1 font-mono text-[11px] font-semibold">{event.name}</p>
        <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all font-mono text-[10px] leading-relaxed opacity-80">
          {JSON.stringify(event.args)}
        </pre>
        {event.error ? <p className="mt-1 text-[10px] text-destructive">{event.error}</p> : null}
      </TooltipContent>
    </Tooltip>
  )
}

/** Suggestion chips for an empty chat. */
export function SuggestionChips({ onPick }: { onPick: (q: string) => void }) {
  const suggestions = [
    'Iqama expiring in 30 days',
    'Unpaid invoices over 60 days',
    'VAT payable this quarter',
    'Payroll summary last month',
    'Workers on each site',
  ]
  return (
    <div className="flex flex-wrap gap-2">
      {suggestions.map((s) => (
        <button
          key={s}
          type="button"
          onClick={() => onPick(s)}
          className="inline-flex items-center gap-1.5 rounded-full border border-gold/40 bg-gold-soft/50 px-3 py-1.5 text-xs font-medium text-gold-deep transition-all hover:border-gold hover:bg-gold-soft hover:shadow-sm"
        >
          <Sparkles className="h-3 w-3" />
          {s}
        </button>
      ))}
    </div>
  )
}

export { formatDateTime }
