// VAT Return Expense bill API — GET / PUT / DELETE a single bill.
// PUT recomputes the VAT breakdown server-side from the CURRENT configured
// rate (and refreshes vatRateSnapshot accordingly).
import { NextRequest } from 'next/server'
import { Prisma } from '@prisma/client'
import { z } from 'zod'
import { db } from '@/lib/db'
import { round2 } from '@/lib/format'
import { getVatRate, splitVat } from '@/lib/vat'
import {
  ok,
  badRequest,
  conflict,
  notFound,
  serverError,
  requirePermission,
  isResponse,
  parseDate,
  logActivity,
} from '@/lib/api-helpers'

const billInclude = {
  createdBy: { select: { id: true, name: true } },
} satisfies Prisma.VatExpenseBillInclude

type BillWithRelations = Prisma.VatExpenseBillGetPayload<{ include: typeof billInclude }>

function mapBill(b: BillWithRelations) {
  return {
    id: b.id,
    billDate: b.billDate.toISOString(),
    billNumber: b.billNumber,
    supplierName: b.supplierName,
    supplierVatNumber: b.supplierVatNumber,
    description: b.description,
    amountWithVat: round2(b.amountWithVat),
    amountWithoutVat: round2(b.amountWithoutVat),
    vatAmount: round2(b.vatAmount),
    vatRateSnapshot: b.vatRateSnapshot,
    createdBy: b.createdBy ? { id: b.createdBy.id, name: b.createdBy.name } : null,
    createdAt: b.createdAt.toISOString(),
  }
}

const billUpdateSchema = z.object({
  billDate: z.string().min(1, 'Bill date is required'),
  billNumber: z.string().min(1, 'Bill number is required'),
  supplierName: z.string().nullable().optional(),
  supplierVatNumber: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  amountWithVat: z.coerce
    .number()
    .positive('Amount must be greater than 0')
    .max(1_000_000_000, 'Amount is too large'),
})

type Params = { params: Promise<{ id: string }> }

export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const auth = await requirePermission('vat.view')
    if (isResponse(auth)) return auth
    const { id } = await params

    const bill = await db.vatExpenseBill.findUnique({ where: { id }, include: billInclude })
    if (!bill) return notFound('VAT bill not found')
    return ok(mapBill(bill))
  } catch {
    return serverError()
  }
}

export async function PUT(req: NextRequest, { params }: Params) {
  try {
    const auth = await requirePermission('vat.edit')
    if (isResponse(auth)) return auth
    const { id } = await params

    const existing = await db.vatExpenseBill.findUnique({ where: { id } })
    if (!existing) return notFound('VAT bill not found')

    let raw: unknown
    try {
      raw = await req.json()
    } catch {
      return badRequest('Invalid JSON body')
    }
    const parsed = billUpdateSchema.safeParse(raw)
    if (!parsed.success) {
      return badRequest(parsed.error.issues[0]?.message ?? 'Invalid request body')
    }
    const body = parsed.data

    const billDate = parseDate(body.billDate)
    if (!billDate) return badRequest('Invalid bill date')

    const billNumber = body.billNumber.trim()
    if (!billNumber) return badRequest('Bill number is required')

    // Unique bill number — excluding the row being edited
    if (billNumber !== existing.billNumber) {
      const duplicate = await db.vatExpenseBill.findUnique({
        where: { billNumber },
        select: { id: true },
      })
      if (duplicate) {
        return conflict(
          `Bill number "${billNumber}" is already used by another bill — bill numbers must be unique.`
        )
      }
    }

    // Recompute the breakdown from the current rate
    const vatRate = await getVatRate()
    const amountWithVat = round2(body.amountWithVat)
    const { amountWithoutVat, vatAmount } = splitVat(amountWithVat, vatRate)

    const updated = await db.vatExpenseBill.update({
      where: { id },
      data: {
        billDate,
        billNumber,
        supplierName: body.supplierName?.trim() || null,
        supplierVatNumber: body.supplierVatNumber?.trim() || null,
        description: body.description?.trim() || null,
        amountWithVat,
        amountWithoutVat,
        vatAmount,
        vatRateSnapshot: vatRate,
      },
      include: billInclude,
    })

    await logActivity({
      user: auth,
      action: 'updated',
      module: 'vat_return',
      description: `VAT bill ${billNumber}${body.supplierName ? ` — ${body.supplierName.trim()}` : ''}`,
      amount: vatAmount,
    })
    return ok(mapBill(updated))
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      return conflict('Bill number already exists — bill numbers must be unique')
    }
    return serverError()
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  try {
    const auth = await requirePermission('vat.delete')
    if (isResponse(auth)) return auth
    const { id } = await params

    const existing = await db.vatExpenseBill.findUnique({ where: { id } })
    if (!existing) return notFound('VAT bill not found')

    await db.vatExpenseBill.delete({ where: { id } })

    await logActivity({
      user: auth,
      action: 'deleted',
      module: 'vat_return',
      description: `VAT bill ${existing.billNumber}${existing.supplierName ? ` — ${existing.supplierName}` : ''}`,
      amount: round2(existing.vatAmount),
    })
    return ok({ deleted: true })
  } catch {
    return serverError()
  }
}
