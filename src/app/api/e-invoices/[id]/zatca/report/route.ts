// POST /api/e-invoices/[id]/zatca/report — submit ONE Phase 2 e-invoice to
// the ZATCA Fatoora gateway (the "connect system" flow for e-invoices).
// Phase 1 e-invoices are rejected: Phase 1 and Phase 2 are SEPARATE
// per-invoice designations (boss requirement — use whichever is needed).
//
//   Simulation mode (profile env = simulation, or preprod/production without
//   a CSID token): full local validation runs, a realistic gateway response
//   is produced and persisted (zatcaStatus / zatcaSubmittedAt /
//   zatcaSubmissionMode='simulation' / zatcaResponse JSON).
//
//   Production mode (env = preprod|production AND CSID token set): the UBL
//   2.1 XML is POSTed to /invoices/clearance/single (standard B2B) with the
//   CSID bearer token (15s timeout). The gateway response is mapped to
//   reported|cleared|rejected and persisted. Network failure → 502 with a
//   clear, actionable message.
//
// Shares the SAME ZATCA connection profile as the classic Invoice module
// (Settings → env / EGS serial / CSID token).
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { round2 } from '@/lib/format'
import {
  ok,
  badRequest,
  notFound,
  serverError,
  requirePermission,
  isResponse,
  logActivity,
} from '@/lib/api-helpers'
import {
  readZatcaProfile,
  readZatcaCsidToken,
} from '@/lib/zatca'
import {
  buildEInvoiceSubmission,
  readEInvoiceSellerInfo,
  computeInvoiceTotals,
} from '@/lib/e-invoice'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ id: string }> }

type ZatcaCheck = {
  name: string
  ok: boolean
  severity: 'error' | 'warning'
  detail: string
}

/** Shape ZATCA's gateway answers with (reporting + clearance variants). */
type ZatcaGatewayResponse = {
  reportingStatus?: string
  clearanceStatus?: string
  status?: number
  messages?: { type?: string; code?: string; message?: string; status?: string }[]
  [key: string]: unknown
}

export async function POST(_req: NextRequest, ctx: Ctx) {
  try {
    const auth = await requirePermission('einvoices.edit')
    if (isResponse(auth)) return auth
    const { id } = await ctx.params

    const invoice = await db.eInvoice.findUnique({
      where: { id },
      include: { items: { orderBy: { sr: 'asc' } } },
    })
    if (!invoice) return notFound('E-Invoice not found')

    // Phase 1 documents never touch the gateway — Phase 1 & Phase 2 are
    // SEPARATE per-invoice designations.
    if ((invoice.zatcaPhase ?? 1) !== 2) {
      return badRequest(
        'Only Phase 2 (Integration) e-invoices can be submitted to ZATCA — switch the document to Phase 2 while it is still a draft'
      )
    }
    if (invoice.status === 'draft') {
      return badRequest('Issue the e-invoice first — ZATCA only accepts issued documents')
    }

    // ---- rebuild the submission (stamp + UBL 2.1 XML, always consistent) ----
    const submission = await buildEInvoiceSubmission(invoice)
    const { xml, invoiceHash, signature, uuid, icv, restamped } = submission

    // ---- local validation (always) ----
    const seller = await readEInvoiceSellerInfo()
    const checks: ZatcaCheck[] = []

    checks.push({
      name: 'Seller VAT number',
      ok: Boolean(seller.vatNumber),
      severity: 'error',
      detail: seller.vatNumber
        ? `Seller VAT ${seller.vatNumber}`
        : 'Seller VAT number is not set in Settings',
    })

    // E-Invoices are standard B2B (0100000) — buyer VAT expected but an
    // unregistered buyer is allowed → warning, not error.
    const buyerVat = invoice.clientVatNumber ?? ''
    checks.push({
      name: 'Buyer VAT number',
      ok: Boolean(buyerVat),
      severity: 'warning',
      detail: buyerVat
        ? `Buyer VAT ${buyerVat}`
        : 'Buyer VAT number is missing — an unregistered buyer is allowed, the invoice will carry a warning',
    })

    // Totals recomputed from the stored items must match the stored aggregates
    const totals = computeInvoiceTotals(invoice.items)
    const totalsOk =
      Math.abs(round2(totals.taxableAmount) - round2(invoice.taxableAmount)) <= 0.01 &&
      Math.abs(round2(totals.vatAmount) - round2(invoice.vatAmount)) <= 0.01 &&
      Math.abs(round2(totals.totalDue) - round2(invoice.totalDue)) <= 0.01
    checks.push({
      name: 'Totals consistent',
      ok: totalsOk,
      severity: 'error',
      detail: totalsOk
        ? `Taxable ${round2(invoice.taxableAmount)} + VAT ${round2(invoice.vatAmount)} = ${round2(invoice.totalDue)}`
        : 'Stored totals do not match the recomputed line items — contact support',
    })

    checks.push({
      name: 'Line items',
      ok: invoice.items.length > 0,
      severity: 'error',
      detail:
        invoice.items.length > 0
          ? `${invoice.items.length} line item${invoice.items.length === 1 ? '' : 's'}`
          : 'The e-invoice has no line items',
    })

    checks.push({
      name: 'Cryptographic stamp',
      ok: Boolean(uuid && invoiceHash && signature),
      severity: 'error',
      detail:
        uuid && invoiceHash && signature
          ? `ICV ${icv} · hash + ECDSA signature present${restamped ? ' (re-signed before this submission)' : ''}`
          : 'The Phase 2 stamp is incomplete — re-issue the document',
    })

    const blocking = checks.filter((c) => !c.ok && c.severity === 'error')
    if (blocking.length > 0) {
      return NextResponse.json(
        {
          error: `ZATCA validation failed: ${blocking.map((c) => c.name).join(', ')}`,
          checks,
        },
        { status: 400 }
      )
    }

    // ---- decide the mode (same connection profile as the Invoice module) ----
    const profile = await readZatcaProfile()
    const csidToken = await readZatcaCsidToken()
    const useProduction = profile.env !== 'simulation' && Boolean(csidToken)
    const mode: 'simulation' | 'production' = useProduction ? 'production' : 'simulation'
    const submittedAt = new Date()
    // E-Invoices are standard B2B tax documents → clearance flow
    const isSimplified = false

    let zatcaStatus: 'reported' | 'cleared' | 'rejected'
    let response: Record<string, unknown>

    if (!useProduction) {
      // ---- SIMULATION: realistic local response, no gateway call ----
      zatcaStatus = isSimplified ? 'reported' : 'cleared'
      response = {
        simulated: true,
        status: isSimplified ? 202 : 200,
        ...(isSimplified
          ? { reportingStatus: 'REPORTED' }
          : { clearanceStatus: 'CLEARED' }),
        reportingTime: submittedAt.toISOString(),
        uuid,
        invoiceHash,
        invoiceCounterValue: icv,
        ...(isSimplified ? {} : { clearanceUuid: `sim-${uuid}` }),
        ...(restamped
          ? { note: 'Stamp was re-signed before submission (document changed since the last stamp)' }
          : {}),
        ...(profile.env !== 'simulation'
          ? { note: `Profile env is ${profile.env} but no CSID token is configured — submission simulated locally` }
          : {}),
        checks,
        messages: [],
      }
    } else {
      // ---- PRODUCTION: POST the UBL to the Fatoora gateway ----
      const endpoint = isSimplified ? 'invoices/report/single' : 'invoices/clearance/single'
      let gateway: ZatcaGatewayResponse
      try {
        const res = await fetch(`${profile.apiBase.replace(/\/$/, '')}/${endpoint}`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${csidToken}`,
            Accept: 'application/json',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            invoiceHash,
            uuid,
            invoice: Buffer.from(xml, 'utf8').toString('base64'),
          }),
          signal: AbortSignal.timeout(15000),
          cache: 'no-store',
        })
        const text = await res.text()
        try {
          gateway = JSON.parse(text) as ZatcaGatewayResponse
        } catch {
          gateway = { status: res.status, messages: [{ message: text.slice(0, 500) }] }
        }
      } catch (err) {
        return NextResponse.json(
          {
            error: `Could not reach the ZATCA gateway (${
              err instanceof Error ? err.message : 'network error'
            }) — check internet connectivity or switch the profile to simulation mode`,
          },
          { status: 502 }
        )
      }

      const reported = (gateway.reportingStatus ?? '').toUpperCase() === 'REPORTED'
      const cleared = (gateway.clearanceStatus ?? '').toUpperCase() === 'CLEARED'
      zatcaStatus = cleared ? 'cleared' : reported ? 'reported' : 'rejected'
      response = { ...gateway, gatewayStatus: gateway.status, checks }
    }

    // ---- persist the submission outcome on the e-invoice ----
    await db.eInvoice.update({
      where: { id },
      data: {
        zatcaStatus,
        zatcaSubmittedAt: submittedAt,
        zatcaSubmissionMode: mode,
        zatcaResponse: JSON.stringify(response),
        // keep the (possibly re-signed) stamp fields in sync
        ...(restamped ? { invoiceHash, signature } : {}),
      },
    })

    await logActivity({
      user: auth,
      action: 'submitted',
      module: 'einvoice',
      description: `E-Invoice ${invoice.invoiceNumber} submitted to ZATCA (Phase 2, ${mode}) — ${zatcaStatus}`,
      amount: round2(invoice.totalDue),
    })

    return ok({
      zatcaStatus,
      zatcaSubmittedAt: submittedAt.toISOString(),
      mode,
      checks,
      response,
    })
  } catch (err) {
    console.error('[api/e-invoices/[id]/zatca/report POST]', err)
    return serverError()
  }
}
