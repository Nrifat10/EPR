// E-Invoice payments API — POST /api/e-invoices/[id]/payments
// Records a payment against an ISSUED (or partially_paid) invoice, then
// recomputes paidAmount = Σ payments and the status:
//   paidAmount ≥ totalDue − 0.005 → 'paid', else 'partially_paid'.
import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { round2 } from '@/lib/format'
import {
  ok,
  badRequest,
  notFound,
  serverError,
  requirePermission,
  isResponse,
  parseDate,
  logActivity,
} from '@/lib/api-helpers'
import { mapEInvoice, eInvoiceDetailInclude } from '../../mappers'

type Ctx = { params: Promise<{ id: string }> }

const paymentSchema = z.object({
  amount: z.coerce
    .number()
    .positive('Payment amount must be greater than 0')
    .max(1_000_000_000, 'Payment amount is too large'),
  paymentDate: z.string().min(1, 'Payment date is required'),
  methodEn: z.string().max(120).nullable().optional(),
  methodAr: z.string().max(120).nullable().optional(),
  reference: z.string().max(80).nullable().optional(),
  notes: z.string().max(500).nullable().optional(),
})

/** Recompute paidAmount + status from the stored payments. */
async function recomputePaymentStatus(eInvoiceId: string) {
  const payments = await db.eInvoicePayment.findMany({
    where: { eInvoiceId },
    select: { amount: true },
  })
  const inv = await db.eInvoice.findUnique({
    where: { id: eInvoiceId },
    select: { totalDue: true },
  })
  const paidAmount = round2(payments.reduce((s, p) => s + p.amount, 0))
  const totalDue = round2(inv?.totalDue ?? 0)
  const status =
    payments.length > 0 && paidAmount >= totalDue - 0.005 ? 'paid' : 'partially_paid'
  await db.eInvoice.update({ where: { id: eInvoiceId }, data: { paidAmount, status } })
  return { paidAmount, status }
}

export async function POST(req: NextRequest, ctx: Ctx) {
  try {
    const auth = await requirePermission('einvoices.edit')
    if (isResponse(auth)) return auth

    const { id } = await ctx.params
    const inv = await db.eInvoice.findUnique({
      where: { id },
      select: { id: true, status: true, invoiceNumber: true },
    })
    if (!inv) return notFound('E-Invoice not found')
    if (inv.status === 'draft') return badRequest('Issue the invoice first')
    if (inv.status === 'paid') return badRequest('This invoice is already fully paid')

    let raw: unknown
    try {
      raw = await req.json()
    } catch {
      return badRequest('Invalid JSON body')
    }
    const parsed = paymentSchema.safeParse(raw)
    if (!parsed.success) {
      return badRequest(parsed.error.issues[0]?.message ?? 'Invalid request body')
    }
    const body = parsed.data

    const paymentDate = parseDate(body.paymentDate)
    if (!paymentDate) return badRequest('Invalid payment date')

    const payment = await db.eInvoicePayment.create({
      data: {
        eInvoiceId: inv.id,
        amount: round2(body.amount),
        paymentDate,
        methodEn: body.methodEn?.trim() || null,
        methodAr: body.methodAr?.trim() || null,
        reference: body.reference?.trim() || null,
        notes: body.notes?.trim() || null,
        createdByName: auth.name,
      },
    })

    const { paidAmount, status } = await recomputePaymentStatus(inv.id)
    const row = await db.eInvoice.findUnique({ where: { id: inv.id }, include: eInvoiceDetailInclude })
    if (!row) return notFound('E-Invoice not found')

    await logActivity({
      user: auth,
      action: 'payment',
      module: 'einvoice',
      description: `Payment ${round2(body.amount).toFixed(2)} recorded on ${inv.invoiceNumber} (${status})`,
      amount: round2(body.amount),
    })
    return ok(
      {
        row: mapEInvoice(row),
        payment: {
          id: payment.id,
          amount: round2(payment.amount),
          paymentDate: payment.paymentDate.toISOString(),
          methodEn: payment.methodEn,
          methodAr: payment.methodAr,
          reference: payment.reference,
          notes: payment.notes,
          createdByName: payment.createdByName,
          createdAt: payment.createdAt.toISOString(),
        },
        paidAmount,
        status,
      },
      201
    )
  } catch (err) {
    console.error('[api/e-invoices/[id]/payments POST]', err)
    return serverError()
  }
}
