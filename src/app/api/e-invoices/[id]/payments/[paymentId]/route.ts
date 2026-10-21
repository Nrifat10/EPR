// E-Invoice payment delete API — DELETE /api/e-invoices/[id]/payments/[paymentId]
// Verifies the payment belongs to the invoice, deletes it and recomputes
// paidAmount/status (no payments left → back to 'issued').
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { round2 } from '@/lib/format'
import {
  ok,
  notFound,
  serverError,
  requirePermission,
  isResponse,
  logActivity,
} from '@/lib/api-helpers'
import { mapEInvoice, eInvoiceDetailInclude } from '../../../mappers'

type Ctx = { params: Promise<{ id: string; paymentId: string }> }

export async function DELETE(_req: NextRequest, ctx: Ctx) {
  try {
    const auth = await requirePermission('einvoices.edit')
    if (isResponse(auth)) return auth

    const { id, paymentId } = await ctx.params
    const inv = await db.eInvoice.findUnique({
      where: { id },
      select: { id: true, invoiceNumber: true },
    })
    if (!inv) return notFound('E-Invoice not found')

    const payment = await db.eInvoicePayment.findUnique({ where: { id: paymentId } })
    if (!payment || payment.eInvoiceId !== inv.id) {
      return notFound('Payment not found on this invoice')
    }

    await db.eInvoicePayment.delete({ where: { id: payment.id } })

    // Recompute: no payments left → back to plain 'issued'
    const remaining = await db.eInvoicePayment.findMany({
      where: { eInvoiceId: inv.id },
      select: { amount: true },
    })
    const paidAmount = round2(remaining.reduce((s, p) => s + p.amount, 0))
    const fresh = await db.eInvoice.findUnique({
      where: { id: inv.id },
      select: { totalDue: true },
    })
    const totalDue = round2(fresh?.totalDue ?? 0)
    const status =
      remaining.length === 0
        ? 'issued'
        : paidAmount >= totalDue - 0.005
          ? 'paid'
          : 'partially_paid'
    await db.eInvoice.update({ where: { id: inv.id }, data: { paidAmount, status } })

    const row = await db.eInvoice.findUnique({ where: { id: inv.id }, include: eInvoiceDetailInclude })
    if (!row) return notFound('E-Invoice not found')

    await logActivity({
      user: auth,
      action: 'payment_deleted',
      module: 'einvoice',
      description: `Payment ${round2(payment.amount).toFixed(2)} deleted from ${inv.invoiceNumber} (${status})`,
      amount: round2(payment.amount),
    })
    return ok({ row: mapEInvoice(row), paidAmount, status, deletedPaymentId: payment.id })
  } catch (err) {
    console.error('[api/e-invoices/[id]/payments/[paymentId] DELETE]', err)
    return serverError()
  }
}
