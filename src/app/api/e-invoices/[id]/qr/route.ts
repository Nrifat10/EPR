// E-Invoice QR API — GET /api/e-invoices/[id]/qr
// Returns { qrPayload, qrDataUrl } for the phase-aware ZATCA TLV QR:
//   Phase 1 → 5 mandatory tags (no crypto)
//   Phase 2 → full 8-tag cryptographic stamp (hash + ECDSA signature + key)
// Works for DRAFTS too (uses issueDate for tag 3 when not yet issued) so the
// print preview can render it before issuing. An unsigned Phase 2 draft
// gracefully falls back to the 5-tag form until it is issued + stamped.
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import {
  ok,
  notFound,
  serverError,
  requirePermission,
  isResponse,
} from '@/lib/api-helpers'
import {
  buildEInvoiceQrPayload,
  qrDataUrl,
  readEInvoiceSellerInfo,
} from '@/lib/e-invoice'
import { getZatcaKeys, ecPublicKeyBase64 } from '@/lib/zatca'

type Ctx = { params: Promise<{ id: string }> }

export async function GET(_req: NextRequest, ctx: Ctx) {
  try {
    const auth = await requirePermission('einvoices.view')
    if (isResponse(auth)) return auth

    const { id } = await ctx.params
    const inv = await db.eInvoice.findUnique({
      where: { id },
      select: {
        zatcaPhase: true,
        issuedAt: true,
        issueDate: true,
        totalDue: true,
        vatAmount: true,
        invoiceHash: true,
        signature: true,
      },
    })
    if (!inv) return notFound('E-Invoice not found')

    const seller = await readEInvoiceSellerInfo()

    // Phase 2 with a complete stored stamp → append tags 6-8
    let stamp: { invoiceHash: string; signature: string; publicKeyBase64: string } | null = null
    if ((inv.zatcaPhase ?? 1) === 2 && inv.invoiceHash && inv.signature) {
      const keys = await getZatcaKeys()
      stamp = {
        invoiceHash: inv.invoiceHash,
        signature: inv.signature,
        publicKeyBase64: ecPublicKeyBase64(keys.publicPem),
      }
    }

    const payload = buildEInvoiceQrPayload(seller, inv, stamp)
    const qr = await qrDataUrl(payload)
    return ok({ qrPayload: payload, qrDataUrl: qr, phase: inv.zatcaPhase ?? 1 })
  } catch (err) {
    console.error('[api/e-invoices/[id]/qr GET]', err)
    return serverError()
  }
}
