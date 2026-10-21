'use client'

// E-Invoice ZATCA Phase 2 submission dialog — the e-invoice "connect system":
//   • read-only connection profile summary (environment badge, EGS serial,
//     CSID token state, gateway URL, last connection test) — configured under
//     Settings → ZATCA e-Invoicing (shared infrastructure)
//   • big "Submit to ZATCA" action → POST /api/e-invoices/[id]/zatca/report
//     with the full validation checklist rendered from the response
//     (severity-colored: error = rose, warning = amber, pass = emerald)
//   • "Download UBL XML" → authenticated fetch → blob download
//
// The report call uses a raw fetch (not api.post) so the 400-response body —
// which carries the failed validation checks — reaches the UI.
import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import {
  AlertTriangle,
  CheckCircle2,
  FileCode,
  Globe2,
  Loader2,
  Send,
  ShieldCheck,
  XCircle,
} from 'lucide-react'

import { api, getAuthToken } from '@/lib/api-client'
import { formatDateTime } from '@/lib/format'
import type { EInvoiceRow } from '@/lib/types'
import { cn } from '@/lib/utils'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  ZatcaChecksList,
  ZatcaStatusBadge,
  type ZatcaCheck,
  type ZatcaProfile,
} from '@/components/app/views/zatca-shared'

/** POST /api/e-invoices/[id]/zatca/report success payload. */
type EReportResult = {
  zatcaStatus: 'reported' | 'cleared' | 'rejected'
  zatcaSubmittedAt: string
  mode: 'simulation' | 'production'
  checks: ZatcaCheck[]
  response: Record<string, unknown>
}

/** Authenticated UBL 2.1 XML download for an e-invoice (fetch → blob). */
export async function downloadEInvoiceUbl(
  invoiceId: string,
  invoiceNumber: string
): Promise<void> {
  const res = await fetch(`/api/e-invoices/${invoiceId}/zatca/ubl`, {
    credentials: 'same-origin',
    headers: {
      ...(getAuthToken() ? { Authorization: `Bearer ${getAuthToken()}` } : {}),
    },
  })
  if (!res.ok) {
    let message = `Download failed (${res.status})`
    try {
      const body = (await res.json()) as { error?: string }
      if (body.error) message = body.error
    } catch {
      // keep default
    }
    throw new Error(message)
  }
  const blob = await res.blob()
  const cd = res.headers.get('Content-Disposition') ?? ''
  const match = /filename="?([^";]+)"?/i.exec(cd)
  const filename = match?.[1] ?? `${invoiceNumber}.xml`
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
  toast.success(`UBL XML downloaded (${filename})`)
}

export function EInvoiceZatcaSubmitDialog({
  open,
  onOpenChange,
  invoice,
  onSubmitted,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Phase 2 e-invoice row (or the freshly-updated row after a submission). */
  invoice: EInvoiceRow | null
  /** Called after a successful submission so the parent list refreshes. */
  onSubmitted?: () => void
}) {
  const [profile, setProfile] = useState<ZatcaProfile | null>(null)
  const [profileLoading, setProfileLoading] = useState(false)
  const [profileError, setProfileError] = useState<string | null>(null)

  const [submitting, setSubmitting] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [result, setResult] = useState<EReportResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  /** Failed-validation checks from a 400 response (shown with the error). */
  const [errorChecks, setErrorChecks] = useState<ZatcaCheck[]>([])

  const reqId = useRef(0)

  const loadProfile = useCallback(async () => {
    const id = ++reqId.current
    setProfileLoading(true)
    setProfileError(null)
    try {
      const p = await api.get<ZatcaProfile>('/api/zatca/profile')
      if (id !== reqId.current) return
      setProfile(p)
    } catch (e) {
      if (id !== reqId.current) return
      setProfileError(e instanceof Error ? e.message : 'Could not load the ZATCA profile')
    } finally {
      if (id === reqId.current) setProfileLoading(false)
    }
  }, [])

  // Fresh profile + reset the result whenever the dialog (re)opens
  useEffect(() => {
    if (!open) return
    setResult(null)
    setError(null)
    setErrorChecks([])
    void loadProfile()
  }, [open, invoice?.id, loadProfile])

  if (!invoice) return null

  async function handleSubmit() {
    if (submitting) return
    setSubmitting(true)
    setError(null)
    setErrorChecks([])
    try {
      // Raw fetch so the 400 body (with the failed checks) is readable here.
      const res = await fetch(`/api/e-invoices/${invoice!.id}/zatca/report`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          ...(getAuthToken() ? { Authorization: `Bearer ${getAuthToken()}` } : {}),
        },
      })
      const body = (await res.json().catch(() => null)) as
        | (EReportResult & { error?: string; checks?: ZatcaCheck[] })
        | null
      if (!res.ok) {
        const message =
          body && typeof body.error === 'string' ? body.error : `Submission failed (${res.status})`
        setError(message)
        setErrorChecks(Array.isArray(body?.checks) ? body!.checks! : [])
        toast.error(message)
        return
      }
      if (!body || typeof body.zatcaStatus !== 'string') {
        const message = 'Unexpected response from the ZATCA report endpoint'
        setError(message)
        toast.error(message)
        return
      }
      setResult(body)
      toast.success(
        body.zatcaStatus === 'cleared'
          ? `E-Invoice ${invoice!.invoiceNumber} cleared by ZATCA`
          : body.zatcaStatus === 'reported'
            ? `E-Invoice ${invoice!.invoiceNumber} reported to ZATCA`
            : `ZATCA rejected e-invoice ${invoice!.invoiceNumber} — check the validation details`
      )
      onSubmitted?.()
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Submission failed'
      setError(message)
      toast.error(message)
    } finally {
      setSubmitting(false)
    }
  }

  async function handleDownloadUbl() {
    if (downloading) return
    setDownloading(true)
    try {
      await downloadEInvoiceUbl(invoice!.id, invoice!.invoiceNumber)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Download failed')
    } finally {
      setDownloading(false)
    }
  }

  const env = profile?.env ?? 'simulation'
  const liveStatus = result?.zatcaStatus ?? invoice.zatcaStatus
  const liveSubmittedAt = result?.zatcaSubmittedAt ?? invoice.zatcaSubmittedAt

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="nice-scrollbar max-h-[90vh] overflow-y-auto sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
            Submit to ZATCA — {invoice.invoiceNumber}
          </DialogTitle>
          <DialogDescription>
            Phase 2 (Integration) e-invoice. The bilingual UBL 2.1 XML is
            validated, then cleared on the Fatoora gateway according to the
            connection profile below.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* ---- Connection profile summary (read-only, shared config) ---- */}
          <div className="rounded-lg border bg-muted/30 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <Globe2 className="h-3.5 w-3.5" />
                Connection Profile
              </p>
              {profileLoading ? (
                <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                  <Loader2 className="h-3 w-3 animate-spin" /> loading…
                </span>
              ) : (
                <Badge
                  className={cn(
                    'font-medium',
                    env === 'production' &&
                      'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300',
                    env === 'preprod' &&
                      'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300'
                  )}
                  variant={env === 'simulation' ? 'secondary' : 'default'}
                >
                  {env === 'simulation' ? 'Simulation' : env === 'preprod' ? 'Pre-production' : 'Production'} mode
                </Badge>
              )}
            </div>
            {profileError ? (
              <p className="mt-2 rounded-md border border-dashed border-amber-300 bg-amber-50 p-2 text-xs text-amber-700 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
                {profileError}
              </p>
            ) : profile ? (
              <dl className="mt-2 grid grid-cols-1 gap-x-4 gap-y-1 text-xs sm:grid-cols-2">
                <div className="min-w-0">
                  <dt className="text-muted-foreground">EGS unit serial</dt>
                  <dd className="truncate font-mono">{profile.egsSerial || '—'}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">CSID token</dt>
                  <dd className="flex items-center gap-1.5">
                    {profile.csidTokenSet ? (
                      <>
                        <CheckCircle2 className="h-3 w-3 text-emerald-600 dark:text-emerald-400" />
                        <span>configured</span>
                      </>
                    ) : (
                      <span className="text-muted-foreground">
                        not set — simulation fallback
                      </span>
                    )}
                  </dd>
                </div>
                <div className="min-w-0 sm:col-span-2">
                  <dt className="text-muted-foreground">Gateway</dt>
                  <dd className="truncate font-mono">{profile.apiBase}</dd>
                </div>
                {profile.lastTest ? (
                  <div className="sm:col-span-2">
                    <dt className="text-muted-foreground">Last connection test</dt>
                    <dd className="flex flex-wrap items-center gap-1.5">
                      {profile.lastTest.ok ? (
                        <CheckCircle2 className="h-3 w-3 text-emerald-600 dark:text-emerald-400" />
                      ) : (
                        <XCircle className="h-3 w-3 text-rose-600 dark:text-rose-400" />
                      )}
                      <span>
                        {profile.lastTest.ok ? 'passed' : 'failed'} ·{' '}
                        {formatDateTime(profile.lastTest.at)} ·{' '}
                        {profile.lastTest.latencyMs} ms
                      </span>
                    </dd>
                  </div>
                ) : null}
              </dl>
            ) : null}
            <p className="mt-2 text-[11px] text-muted-foreground">
              Configure the gateway under{' '}
              <span className="font-medium text-foreground">Settings → ZATCA e-Invoicing</span>.
            </p>
          </div>

          {/* ---- Current submission state ---- */}
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Current status
              </p>
              {liveStatus ? (
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <ZatcaStatusBadge status={liveStatus} />
                  <span className="text-xs text-muted-foreground">
                    {liveSubmittedAt ? formatDateTime(liveSubmittedAt) : ''}
                  </span>
                </div>
              ) : (
                <p className="mt-1 text-xs text-muted-foreground">
                  Not submitted — this e-invoice has not been sent to ZATCA yet.
                </p>
              )}
            </div>
            {invoice.status === 'draft' ? (
              <p className="flex items-center gap-1.5 text-xs font-medium text-amber-600 dark:text-amber-400">
                <AlertTriangle className="h-3.5 w-3.5" />
                Draft — issue it first
              </p>
            ) : null}
          </div>

          {/* ---- Submission result / error ---- */}
          {error ? (
            <div className="space-y-2 rounded-lg border border-rose-200 bg-rose-50 p-3 dark:border-rose-900 dark:bg-rose-950">
              <p className="flex items-start gap-2 text-xs font-semibold text-rose-700 dark:text-rose-300">
                <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
                {error}
              </p>
              {errorChecks.length > 0 ? <ZatcaChecksList checks={errorChecks} /> : null}
            </div>
          ) : null}

          {result ? (
            <div className="space-y-2 rounded-lg border border-emerald-200 bg-emerald-50/60 p-3 dark:border-emerald-900 dark:bg-emerald-950/60">
              <div className="flex flex-wrap items-center gap-2">
                <ZatcaStatusBadge status={result.zatcaStatus} />
                <span className="text-xs text-muted-foreground">
                  {result.mode === 'production' ? 'live gateway' : 'simulation'} ·{' '}
                  {formatDateTime(result.zatcaSubmittedAt)}
                </span>
              </div>
              <ZatcaChecksList checks={result.checks} />
            </div>
          ) : null}
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            type="button"
            variant="outline"
            onClick={() => void handleDownloadUbl()}
            disabled={downloading}
          >
            {downloading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <FileCode className="h-4 w-4" />
            )}
            UBL XML
          </Button>
          <Button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={submitting || invoice.status === 'draft'}
          >
            {submitting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
            {result ? 'Submit again' : 'Submit to ZATCA'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
