// GET /api/e-invoices/[id]/zatca/ubl — download the UBL 2.1 XML of a Phase 2
// e-invoice (the exact document whose SHA-256 hash is QR tag 6 / the stored
// invoiceHash). Phase 2 only — Phase 1 documents have no UBL submission.
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import {
  badRequest,
  notFound,
  serverError,
  requirePermission,
  isResponse,
} from '@/lib/api-helpers'
import { buildEInvoiceSubmission } from '@/lib/e-invoice'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ id: string }> }

export async function GET(_req: NextRequest, ctx: Ctx) {
  try {
    const auth = await requirePermission('einvoices.view')
    if (isResponse(auth)) return auth
    const { id } = await ctx.params

    const invoice = await db.eInvoice.findUnique({
      where: { id },
      include: { items: { orderBy: { sr: 'asc' } } },
    })
    if (!invoice) return notFound('E-Invoice not found')

    if ((invoice.zatcaPhase ?? 1) !== 2) {
      return badRequest('Only Phase 2 (Integration) e-invoices have a UBL XML document')
    }

    const submission = await buildEInvoiceSubmission(invoice)

    return new NextResponse(submission.xml, {
      status: 200,
      headers: {
        'Content-Type': 'application/xml; charset=utf-8',
        'Content-Disposition': `attachment; filename="${invoice.invoiceNumber}.xml"`,
      },
    })
  } catch (err) {
    console.error('[api/e-invoices/[id]/zatca/ubl GET]', err)
    return serverError()
  }
}
