'use client'

// Share dialog — download the PDF (browser print), send via WhatsApp (wa.me
// pre-filled text — attach the downloaded PDF) or Email (mailto), or copy the
// summary text. No public URLs are exposed: lists stay behind the login.
import { useState } from 'react'
import { toast } from 'sonner'
import { Check, Copy, Download, Mail, MessageCircle } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { nlFormatDate } from '@/lib/name-list-utils'
import type { NameListDetail } from '@/lib/types'

export function ShareDialog({
  open,
  onOpenChange,
  list,
  onPrint,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  list: NameListDetail
  onPrint: () => void
}) {
  const [copied, setCopied] = useState(false)

  const summary = `Name List ${list.listNo} — ${list.subjectName}
Client: ${list.clientName}
Date: ${nlFormatDate(list.date)}${list.time ? ` ${list.time}` : ''}
${list.subjectKind === 'mobilization' ? `Site: ${list.projectName ?? list.location ?? '—'}` : `Location: ${list.location ?? '—'}`}
Total workers: ${list.workers.length}
Trades: ${[...new Set(list.workers.map((w) => w.staff.categoryName ?? '—'))].join(', ')}`

  function shareWhatsApp() {
    const text = encodeURIComponent(
      `*${list.listNo} — ${list.subjectName}*\n${list.clientName}\n${nlFormatDate(list.date)}${list.time ? ` ${list.time}` : ''}\n${list.workers.length} workers — full list in the attached PDF.`
    )
    window.open(`https://wa.me/?text=${text}`, '_blank', 'noopener')
    toast.info('Attach the downloaded PDF in WhatsApp before sending.')
  }

  function shareEmail() {
    const subject = encodeURIComponent(`${list.listNo} — ${list.subjectName} (${list.clientName})`)
    const body = encodeURIComponent(`${summary}\n\nThe PDF is attached.`)
    window.location.href = `mailto:?subject=${subject}&body=${body}`
    toast.info('Attach the downloaded PDF in your email app.')
  }

  async function copySummary() {
    try {
      await navigator.clipboard.writeText(summary)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      toast.error('Could not copy — select the text manually.')
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Share {list.listNo}</DialogTitle>
          <DialogDescription>
            Download the PDF first, then attach it in WhatsApp or email. Lists themselves stay
            inside the ERP (login required).
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-2">
          <Button variant="outline" className="justify-start" onClick={onPrint}>
            <Download className="h-4 w-4" /> Download PDF (print → Save as PDF)
          </Button>
          <Button variant="outline" className="justify-start" onClick={shareWhatsApp}>
            <MessageCircle className="h-4 w-4 text-emerald-600" /> Send on WhatsApp
          </Button>
          <Button variant="outline" className="justify-start" onClick={shareEmail}>
            <Mail className="h-4 w-4" /> Send by Email
          </Button>
          <Button variant="outline" className="justify-start" onClick={copySummary}>
            {copied ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
            {copied ? 'Copied!' : 'Copy summary text'}
          </Button>
        </div>

        <DialogFooter className="justify-start">
          <pre className="w-full whitespace-pre-wrap rounded-md border bg-muted/40 p-2.5 text-[11px] leading-relaxed text-muted-foreground">
            {summary}
          </pre>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
