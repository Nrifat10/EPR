'use client'

// Markdown renderer for AI answers: GFM tables, code, lists + special
// draft placeholders (%%DRAFT:n%%) and ```chart blocks.
import { memo, useMemo, type ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { cn } from '@/lib/utils'
import type { AiDraft } from '@/lib/types'
import { DraftCard } from './draft-card'
import { ChartBlock } from './chart-block'

export type ChartSpec = {
  type: 'bar' | 'line'
  title?: string
  xLabel?: string
  yLabel?: string
  labels: string[]
  series: { name: string; data: number[] }[]
}

/** Split content into markdown segments, draft refs and chart blocks. */
type Segment =
  | { kind: 'md'; text: string }
  | { kind: 'draft'; index: number }
  | { kind: 'chart'; spec: ChartSpec }

function segment(content: string, drafts: AiDraft[]): Segment[] {
  const out: Segment[] = []
  const re = /%%DRAFT:(\d+)%%|```chart\s*\n([\s\S]*?)```/g
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(content))) {
    if (m.index > last) out.push({ kind: 'md', text: content.slice(last, m.index) })
    if (m[1] !== undefined) {
      const idx = parseInt(m[1], 10)
      if (idx >= 0 && idx < drafts.length) out.push({ kind: 'draft', index: idx })
    } else if (m[2] !== undefined) {
      try {
        const spec = JSON.parse(m[2].trim()) as ChartSpec
        if (Array.isArray(spec.labels) && Array.isArray(spec.series)) {
          out.push({ kind: 'chart', spec })
        }
      } catch {
        // malformed chart block → drop silently
      }
    }
    last = re.lastIndex
  }
  if (last < content.length) out.push({ kind: 'md', text: content.slice(last) })
  return out
}

export const AiMarkdown = memo(function AiMarkdown({
  content,
  drafts,
  streaming,
}: {
  content: string
  drafts: AiDraft[]
  streaming?: boolean
}) {
  const segments = useMemo(() => segment(content, drafts), [content, drafts])
  return (
    <div className="ai-markdown">
      {segments.map((s, i) =>
        s.kind === 'draft' ? (
          <DraftCard key={`d-${i}`} draft={drafts[s.index]} />
        ) : s.kind === 'chart' ? (
          <ChartBlock key={`c-${i}`} spec={s.spec} />
        ) : (
          <Md key={`m-${i}`} text={s.text} streaming={streaming && i === segments.length - 1} />
        )
      )}
    </div>
  )
})

function Md({ text, streaming }: { text: string; streaming?: boolean }) {
  return (
    <>
      <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        table: ({ children }) => (
          <div className="nice-scrollbar my-3 max-w-full overflow-x-auto rounded-lg border border-border/70 shadow-sm">
            <table className="w-full border-collapse text-[13px]">{children}</table>
          </div>
        ),
        thead: ({ children }) => (
          <thead className="bg-primary text-primary-foreground">{children}</thead>
        ),
        th: ({ children }) => (
          <th className="border-b border-border/40 px-3 py-2 text-left font-semibold leading-snug">
            {children}
          </th>
        ),
        td: ({ children }) => (
          <td className="border-b border-border/40 px-3 py-1.5 align-top [&:has(>strong)]:whitespace-nowrap">
            {children}
          </td>
        ),
        tr: ({ children }) => (
          <tr className="even:bg-muted/40 transition-colors hover:bg-muted/70">{children}</tr>
        ),
        p: ({ children }) => <p className="leading-relaxed">{children}</p>,
        ul: ({ children }) => <ul className="list-disc space-y-1 pl-5">{children}</ul>,
        ol: ({ children }) => <ol className="list-decimal space-y-1 pl-5">{children}</ol>,
        li: ({ children }) => <li className="leading-relaxed">{children}</li>,
        h1: ({ children }) => <h3 className="mt-3 text-base font-bold">{children}</h3>,
        h2: ({ children }) => <h3 className="mt-3 text-base font-bold">{children}</h3>,
        h3: ({ children }) => <h4 className="mt-2 text-sm font-bold">{children}</h4>,
        strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
        blockquote: ({ children }) => (
          <blockquote className="my-2 border-l-2 border-gold pl-3 text-muted-foreground">
            {children}
          </blockquote>
        ),
        code: ({ className, children }) => {
          const isBlock = /language-/.test(className ?? '')
          if (isBlock) {
            return (
              <code className="block overflow-x-auto whitespace-pre rounded-lg bg-muted p-3 font-mono text-xs">
                {children}
              </code>
            )
          }
          return (
            <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[0.85em]">{children}</code>
          )
        },
        pre: ({ children }) => <pre className="my-2">{children}</pre>,
        a: ({ children, href }) => (
          <a href={href} target="_blank" rel="noreferrer" className="text-primary underline underline-offset-2">
            {children}
          </a>
        ),
        hr: () => <hr className="my-3 border-border/60" />,
      }}
    >
      {text}
    </ReactMarkdown>
      {streaming ? <span className="ai-caret" aria-hidden /> : null}
    </>
  )
}

/** Compact one-line markdown (chat history previews). */
export function AiPreview({ text, className }: { text: string; className?: string }) {
  const clean = text.replace(/```[\s\S]*?```/g, ' ').replace(/[#*`>|]/g, '').replace(/\s+/g, ' ').trim()
  return <span className={cn('truncate', className)}>{clean}</span>
}

export type { ReactNode }
