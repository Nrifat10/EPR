// E-Invoice issue API — POST /api/e-invoices/[id]/issue
// Draft → issued. Assigns the ZATCA readiness data at issue time:
//   uuid (v4) · icv (sequential across all issued e-invoices) ·
//   previousHash (latest issued e-invoice's hash, PIH chain — starts at
//   ZATCA_INITIAL_PIH) · invoiceHash (base64 SHA-256 of the UBL XML).
// PHASE 2 documents additionally get the ECDSA signature of the hash
// (8-tag cryptographic QR). Totals are defensively recomputed first.
// Response: full updated row + qrPayload + qrDataUrl.
import { NextRequest } from 'next/server'
import { randomUUID } from 'node:crypto'
import { db } from '@/lib/db'
import {
  ok,
  badRequest,
  notFound,
  serverError,
  requirePermission,
  isResponse,
  logActivity,
} from '@/lib/api-helpers'
import { getZatcaKeys, signHash, ecPublicKeyBase64 } from '@/lib/zatca'
import {
  computeInvoiceTotals,
  buildEInvoiceXml,
  hashEInvoiceXml,
  buildEInvoiceQrPayload,
  qrDataUrl,
  readEInvoiceSellerInfo,
  ZATCA_INITIAL_PIH,
} from '@/lib/e-invoice'
import { mapEInvoice, eInvoiceDetailInclude } from '../../mappers'

type Ctx = { params: Promise<{ id: string }> }

export async function POST(_req: NextRequest, ctx: Ctx) {
  try {
    const auth = await requirePermission('einvoices.edit')
    if (isResponse(auth)) return auth

    const { id } = await ctx.params
    const inv = await db.eInvoice.findUnique({ where: { id }, include: { items: true } })
    if (!inv) return notFound('E-Invoice not found')
    if (inv.status !== 'draft') return badRequest('Only draft e-invoices can be issued')

    // Defensive recompute from stored items (never trust stored aggregates)
    const items = [...inv.items].sort((a, b) => a.sr - b.sr)
    const totals = computeInvoiceTotals(items)

    // PIH chain: latest issued e-invoice (highest icv) — or the KSA seed
    const prev = await db.eInvoice.findFirst({
      where: { icv: { not: null }, invoiceHash: { not: null } },
      orderBy: [{ icv: 'desc' }, { issuedAt: 'desc' }],
      select: { invoiceHash: true },
    })
    const previousHash = prev?.invoiceHash ?? ZATCA_INITIAL_PIH

    // ICV: 1-based counter across ALL issued e-invoices
    const maxIcv = await db.eInvoice.aggregate({
      where: { icv: { not: null } },
      _max: { icv: true },
    })
    const icv = (maxIcv._max.icv ?? 0) + 1

    const uuid = randomUUID()
    const seller = await readEInvoiceSellerInfo()

    // The XML embeds the final uuid/icv/previousHash so the hash covers them
    const xml = buildEInvoiceXml({ ...inv, ...totals, uuid }, items, seller, previousHash, icv)
    const invoiceHash = hashEInvoiceXml(xml)

    // PHASE 2 (Integration): sign the hash with the ZATCA ECDSA keypair —
    // the QR grows to the full 8-tag cryptographic stamp and the document
    // becomes ready for the Fatoora gateway (submit from the list view).
    let signature: string | null = null
    let publicKeyBase64 = ''
    if ((inv.zatcaPhase ?? 1) === 2) {
      const keys = await getZatcaKeys()
      signature = signHash(keys.privatePem, Buffer.from(invoiceHash, 'base64'))
      publicKeyBase64 = ecPublicKeyBase64(keys.publicPem)
    }

    const issuedAt = new Date()
    const updated = await db.eInvoice.update({
      where: { id: inv.id },
      data: {
        ...totals,
        uuid,
        icv,
        previousHash,
        invoiceHash,
        ...(signature ? { signature } : {}),
        status: 'issued',
        issuedAt,
        issuedByName: auth.name,
      },
      include: eInvoiceDetailInclude,
    })

    const payload = buildEInvoiceQrPayload(
      seller,
      updated,
      signature ? { invoiceHash, signature, publicKeyBase64 } : null
    )
    const qr = await qrDataUrl(payload)

    await logActivity({
      user: auth,
      action: 'issued',
      module: 'einvoice',
      description: `E-Invoice ${updated.invoiceNumber} issued (ZATCA Phase ${updated.zatcaPhase ?? 1}) — ${updated.clientNameEn}`,
      amount: totals.totalDue,
    })
    return ok({ ...mapEInvoice(updated), qrPayload: payload, qrDataUrl: qr })
  } catch (err) {
    console.error('[api/e-invoices/[id]/issue POST]', err)
    return serverError()
  }
}
