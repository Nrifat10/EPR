// E-Invoice duplicate API — POST /api/e-invoices/[id]/duplicate
// Works on ANY status. Creates a NEW DRAFT copy: new number (same docType —
// duplicating a credit_note makes a new credit note draft), header fields and
// items copied (Arabic fields + manual flags included). Payments, issue data
// (uuid/icv/hashes/issuedAt) and the signed copy are NOT copied.
// relatedInvoiceId is kept only for note-type documents.
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import {
  ok,
  notFound,
  serverError,
  requirePermission,
  isResponse,
  logActivity,
} from '@/lib/api-helpers'
import { nextEInvoiceNumber } from '@/lib/e-invoice'
import { mapEInvoice, eInvoiceDetailInclude } from '../../mappers'

type Ctx = { params: Promise<{ id: string }> }

export async function POST(_req: NextRequest, ctx: Ctx) {
  try {
    const auth = await requirePermission('einvoices.create')
    if (isResponse(auth)) return auth

    const { id } = await ctx.params
    const source = await db.eInvoice.findUnique({ where: { id }, include: { items: true } })
    if (!source) return notFound('E-Invoice not found')

    const items = [...source.items]
      .sort((a, b) => a.sr - b.sr)
      .map((it) => ({
        sr: it.sr,
        descriptionEn: it.descriptionEn,
        descriptionAr: it.descriptionAr,
        descArManual: it.descArManual,
        unitEn: it.unitEn,
        unitAr: it.unitAr,
        unitArManual: it.unitArManual,
        quantity: it.quantity,
        unitPrice: it.unitPrice,
        discount: it.discount,
        vatPercent: it.vatPercent,
        taxableAmount: it.taxableAmount,
        vatAmount: it.vatAmount,
        lineTotal: it.lineTotal,
      }))

    const copy = await db.$transaction(async (tx) => {
      const invoiceNumber = await nextEInvoiceNumber(source.docType, source.issueDate, tx)
      return tx.eInvoice.create({
        data: {
          invoiceNumber,
          docType: source.docType,
          clientId: source.clientId,
          clientNameEn: source.clientNameEn,
          clientNameAr: source.clientNameAr,
          clientVatNumber: source.clientVatNumber,
          clientCrNumber: source.clientCrNumber,
          clientAddressEn: source.clientAddressEn,
          clientAddressAr: source.clientAddressAr,
          poRef: source.poRef,
          contractRef: source.contractRef,
          projectEn: source.projectEn,
          projectAr: source.projectAr,
          paymentTermsEn: source.paymentTermsEn,
          paymentTermsAr: source.paymentTermsAr,
          paymentMethodEn: source.paymentMethodEn,
          paymentMethodAr: source.paymentMethodAr,
          issueDate: source.issueDate,
          supplyDate: source.supplyDate,
          dueDate: source.dueDate,
          status: 'draft',
          subtotal: source.subtotal,
          totalDiscount: source.totalDiscount,
          taxableAmount: source.taxableAmount,
          vatAmount: source.vatAmount,
          totalDue: source.totalDue,
          notesEn: source.notesEn,
          notesAr: source.notesAr,
          arManualFlags: source.arManualFlags,
          showReceiverSignature: source.showReceiverSignature,
          // notes keep their correction target; plain invoices drop the link
          relatedInvoiceId:
            source.docType === 'credit_note' || source.docType === 'debit_note'
              ? source.relatedInvoiceId
              : null,
          items: { create: items },
        },
        include: eInvoiceDetailInclude,
      })
    })

    await logActivity({
      user: auth,
      action: 'duplicated',
      module: 'einvoice',
      description: `E-Invoice ${copy.invoiceNumber} duplicated from ${source.invoiceNumber}`,
      amount: copy.totalDue,
    })
    return ok(mapEInvoice(copy), 201)
  } catch (err) {
    console.error('[api/e-invoices/[id]/duplicate POST]', err)
    return serverError()
  }
}
