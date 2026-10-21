// Next e-invoice number preview — GET /api/e-invoices/next-number?docType=
// Static segment, matched before the dynamic [id] route. Gives the form a
// live hint of the number the server will assign on save.
import { NextRequest } from 'next/server'
import { ok, badRequest, serverError, requirePermission, isResponse } from '@/lib/api-helpers'
import { nextEInvoiceNumber, DOC_PREFIX } from '@/lib/e-invoice'

export async function GET(req: NextRequest) {
  try {
    const auth = await requirePermission('einvoices.view')
    if (isResponse(auth)) return auth

    const docType = req.nextUrl.searchParams.get('docType')?.trim() || 'invoice'
    if (!(docType in DOC_PREFIX)) return badRequest('docType must be invoice, credit_note or debit_note')

    const nextNumber = await nextEInvoiceNumber(docType, new Date())
    return ok({ nextNumber, docType })
  } catch (err) {
    console.error('[api/e-invoices/next-number GET]', err)
    return serverError()
  }
}
