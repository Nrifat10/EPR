'use client'

// Chat composer: auto-growing textarea + file upload chips + voice input
// (browser speech recognition) + send/stop button.
import { useEffect, useRef, useState } from 'react'
import {
  FileText,
  FileUp,
  Loader2,
  Mic,
  MicOff,
  Paperclip,
  Send,
  Square,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { PendingUpload, StreamStatus } from './use-ai-chat'

// Minimal typings for the browser speech API
type SpeechRecognitionLike = {
  lang: string
  continuous: boolean
  interimResults: boolean
  start: () => void
  stop: () => void
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null
  onend: (() => void) | null
  onerror: (() => void) | null
}

export function Composer({
  value,
  onChange,
  onSend,
  onStop,
  status,
  uploads,
  onFiles,
  onRemoveUpload,
  placeholder,
  autoFocus,
}: {
  value: string
  onChange: (v: string) => void
  onSend: () => void
  onStop: () => void
  status: StreamStatus
  uploads: PendingUpload[]
  onFiles: (files: File[]) => void
  onRemoveUpload: (name: string) => void
  placeholder?: string
  autoFocus?: boolean
}) {
  const taRef = useRef<HTMLTextAreaElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const [listening, setListening] = useState(false)
  const recRef = useRef<SpeechRecognitionLike | null>(null)
  const busy = status === 'connecting' || status === 'thinking' || status === 'writing'

  // auto-grow
  useEffect(() => {
    const ta = taRef.current
    if (!ta) return
    ta.style.height = 'auto'
    ta.style.height = `${Math.min(ta.scrollHeight, 160)}px`
  }, [value])

  useEffect(() => {
    if (autoFocus) taRef.current?.focus()
  }, [autoFocus])

  // keyboard: Enter sends (Shift+Enter = newline)
  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      if (!busy) onSend()
    }
  }

  // ── voice input (browser speech recognition) ──
  const toggleVoice = () => {
    if (listening) {
      recRef.current?.stop()
      setListening(false)
      return
    }
    const w = window as unknown as {
      SpeechRecognition?: new () => SpeechRecognitionLike
      webkitSpeechRecognition?: new () => SpeechRecognitionLike
    }
    const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition
    if (!Ctor) {
      toast.error('Voice input is not supported in this browser')
      return
    }
    const rec = new Ctor()
    recRef.current = rec
    rec.lang = /[\u0980-\u09FF]/.test(value) ? 'bn-BD' : /[ضصثقفغعهخحجدشسيبلاتنمكطئءؤرلاىةوزظ]/.test(value) ? 'ar-SA' : 'en-US'
    rec.continuous = true
    rec.interimResults = false
    rec.onresult = (e) => {
      let text = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        text += e.results[i][0].transcript
      }
      if (text) onChange(value ? `${value} ${text}` : text)
    }
    rec.onend = () => setListening(false)
    rec.onerror = () => setListening(false)
    try {
      rec.start()
      setListening(true)
    } catch {
      toast.error('Could not start the microphone')
    }
  }

  return (
    <div className="space-y-2">
      {/* upload chips */}
      {uploads.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {uploads.map((u) => (
            <span
              key={u.name}
              className={cn(
                'inline-flex max-w-64 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px]',
                u.error
                  ? 'border-destructive/40 bg-destructive/10 text-destructive'
                  : 'border-border bg-muted/60 text-muted-foreground'
              )}
              title={u.error ?? `${Math.round(u.size / 1024)} KB`}
            >
              {u.uploading ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <FileText className="h-3 w-3 shrink-0" />
              )}
              <span className="truncate">{u.name}</span>
              {u.error ? (
                <span className="truncate font-medium">{u.error.slice(0, 40)}</span>
              ) : u.text ? (
                <span className="shrink-0 opacity-70">✓ read</span>
              ) : null}
              <button
                type="button"
                onClick={() => onRemoveUpload(u.name)}
                className="ml-0.5 shrink-0 rounded-full p-0.5 hover:bg-foreground/10"
                aria-label={`Remove ${u.name}`}
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      ) : null}

      <div
        className={cn(
          'flex items-end gap-1.5 rounded-2xl border bg-card p-1.5 pl-2 shadow-sm transition-colors',
          listening ? 'border-gold ring-2 ring-gold/20' : 'border-border/80 focus-within:border-gold/60 focus-within:ring-2 focus-within:ring-gold/15'
        )}
      >
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={busy}
          className="mb-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40"
          title="Attach file (PDF, image, Excel/CSV, text)"
          aria-label="Attach file"
        >
          <Paperclip className="h-4 w-4" />
        </button>
        <input
          ref={fileRef}
          type="file"
          className="hidden"
          multiple
          accept=".pdf,.png,.jpg,.jpeg,.webp,.gif,.bmp,.xlsx,.xls,.csv,.txt,.md,.json,image/*"
          onChange={(e) => {
            const files = Array.from(e.target.files ?? [])
            if (files.length) onFiles(files)
            e.target.value = ''
          }}
        />

        <textarea
          ref={taRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          rows={1}
          placeholder={placeholder ?? 'Ask about your ERP data or anything… (Enter to send)'}
          className="nice-scrollbar max-h-40 min-h-9 flex-1 resize-none bg-transparent py-1.5 text-sm outline-none placeholder:text-muted-foreground/70"
          aria-label="Message"
        />

        <button
          type="button"
          onClick={toggleVoice}
          className={cn(
            'mb-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors',
            listening
              ? 'bg-gold text-gold-foreground shadow-sm'
              : 'text-muted-foreground hover:bg-muted hover:text-foreground'
          )}
          title={listening ? 'Stop voice input' : 'Voice input'}
          aria-label={listening ? 'Stop voice input' : 'Voice input'}
        >
          {listening ? <MicOff className="h-4 w-4 animate-pulse" /> : <Mic className="h-4 w-4" />}
        </button>

        {busy ? (
          <Button
            size="sm"
            variant="destructive"
            onClick={onStop}
            className="mb-0.5 h-9 w-9 shrink-0 rounded-xl p-0"
            title="Stop"
            aria-label="Stop generating"
          >
            <Square className="h-4 w-4 fill-current" />
          </Button>
        ) : (
          <Button
            size="sm"
            onClick={onSend}
            disabled={!value.trim() && uploads.filter((u) => !u.error && !u.uploading).length === 0}
            className="mb-0.5 h-9 w-9 shrink-0 rounded-xl p-0"
            title="Send"
            aria-label="Send message"
          >
            <Send className="h-4 w-4" />
          </Button>
        )}
      </div>
      {listening ? (
        <p className="flex items-center gap-1.5 pl-2 text-[11px] text-gold-deep">
          <FileUp className="h-3 w-3" /> Listening… speak now (click the mic again to stop)
        </p>
      ) : null}
    </div>
  )
}
