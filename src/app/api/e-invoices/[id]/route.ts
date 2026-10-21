// E-Invoice detail API — GET (full detail) / PUT (draft only) / DELETE (draft only).
// Issued invoices are LOCKED: PUT/DELETE return 400 telling the user to use a
// Credit/Debit Note for corrections (signed-copy upload stays open — separate
// route). PUT replaces all items (delete + recreate) inside one transaction
// and keeps the invoiceNumber unchanged; every money figure is recomputed.
import { NextRequest } from 'next/server'
import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
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
import { computeInvoiceTotals } from '@/lib/e-invoice'
import {
  mapEInvoice,
  eInvoiceDetailInclude,
  eInvoiceSchema,
  normalizeEItems,
  backfillClientArabic,
} from '../mappers'

type Ctx = { params: Promise<{ id: string }> }

export async function GET(_req: NextRequest, ctx: Ctx) {
  try {
    const auth = await requirePermission('einvoices.view')
    if (isResponse(auth)) return auth

    const { id } = await ctx.params
    const inv = await db.eInvoice.findUnique({ where: { id }, include: eInvoiceDetailInclude })
    if (!inv) return notFound('E-Invoice not found')
    return ok(mapEInvoice(inv))
  } catch (err) {
    console.error('[api/e-invoices/[id] GET]', err)
    return serverError()
  }
}

export async function PUT(req: NextRequest, ctx: Ctx) {
  try {
    const auth = await requirePermission('einvoices.edit')
    if (isResponse(auth)) return auth

    const { id } = await ctx.params
    const existing = await db.eInvoice.findUnique({
      where: { id },
      select: { id: true, status: true, invoiceNumber: true },
    })
    if (!existing) return notFound('E-Invoice not found')
    if (existing.status !== 'draft') {
      return badRequest('Issued invoices are locked — use a Credit/Debit Note for corrections')
    }

    let raw: unknown
    try {
      raw = await req.json()
    } catch {
      return badRequest('Invalid JSON body')
    }
    const parsed = eInvoiceSchema.safeParse(raw)
    if (!parsed.success) {
      return badRequest(parsed.error.issues[0]?.message ?? 'Invalid request body')
    }
    const body = parsed.data

    const issueDate = parseDate(body.issueDate)
    if (!issueDate) return badRequest('Invalid issue date')
    const supplyDate = parseDate(body.supplyDate)
    if (body.supplyDate && !supplyDate) return badRequest('Invalid supply date')
    const dueDate = parseDate(body.dueDate)
    if (body.dueDate && !dueDate) return badRequest('Invalid due date')

    const docType = body.docType ?? 'invoice'

    // Linked client + Arabic copy-in (same rules as POST)
    let clientId: string | null = null
    let clientNameAr = body.clientNameAr ?? ''
    let clientAddressAr = body.clientAddressAr ?? null
    if (body.clientId) {
      const client = await db.client.findUnique({
        where: { id: body.clientId },
        select: { id: true, nameAr: true, addressAr: true },
      })
      if (!client) return badRequest('Selected client was not found')
      clientId = client.id
      if (!clientNameAr.trim() && client.nameAr) clientNameAr = client.nameAr
      if (!clientAddressAr?.trim() && client.addressAr) clientAddressAr = client.addressAr
    }

    // Credit/Debit notes reference an ISSUED invoice (never themselves)
    let relatedInvoiceId: string | null = null
    if (docType !== 'invoice' && body.relatedInvoiceId) {
      if (body.relatedInvoiceId === id) {
        return badRequest('An e-invoice cannot reference itself')
      }
      const related = await db.eInvoice.findUnique({
        where: { id: body.relatedInvoiceId },
        select: { id: true, status: true },
      })
      if (!related) return badRequest('Related invoice was not found')
      if (related.status === 'draft') {
        return badRequest('Related invoice must be issued before it can be corrected by a note')
      }
      relatedInvoiceId = related.id
    }

    const { items, error: itemError } = normalizeEItems(body.items)
    if (itemError || !items) return badRequest(itemError ?? 'Invalid line items')
    const totals = computeInvoiceTotals(items)

    const updated = await db.$transaction(async (tx) => {
      await tx.eInvoiceItem.deleteMany({ where: { eInvoiceId: id } })
      return tx.eInvoice.update({
        where: { id },
        data: {
          docType,
          clientId,
          clientNameEn: body.clientNameEn.trim(),
          clientNameAr: clientNameAr.trim(),
          clientVatNumber: body.clientVatNumber?.trim() || null,
          clientCrNumber: body.clientCrNumber?.trim() || null,
          clientAddressEn: body.clientAddressEn?.trim() || null,
          clientAddressAr: clientAddressAr?.trim() || null,
          poRef: body.poRef?.trim() || null,
          contractRef: body.contractRef?.trim() || null,
          projectEn: body.projectEn?.trim() || null,
          projectAr: body.projectAr?.trim() || null,
          paymentTermsEn: body.paymentTermsEn?.trim() || null,
          paymentTermsAr: body.paymentTermsAr?.trim() || null,
          paymentMethodEn: body.paymentMethodEn?.trim() || null,
          paymentMethodAr: body.paymentMethodAr?.trim() || null,
          issueDate,
          supplyDate,
          dueDate,
          subtotal: totals.subtotal,
          totalDiscount: totals.totalDiscount,
          taxableAmount: totals.taxableAmount,
          vatAmount: totals.vatAmount,
          totalDue: totals.totalDue,
          notesEn: body.notesEn?.trim() || null,
          notesAr: body.notesAr?.trim() || null,
          arManualFlags: JSON.stringify(body.arManualFlags ?? []),
          showReceiverSignature: body.showReceiverSignature ?? true,
          // Phase is editable while draft (the route only runs for drafts)
          ...(body.zatcaPhase ? { zatcaPhase: body.zatcaPhase } : {}),
          relatedInvoiceId,
          items: { create: items },
        },
        include: eInvoiceDetailInclude,
      })
    })

    if (clientId) {
      await backfillClientArabic(clientId, updated.clientNameAr, updated.clientAddressAr)
    }

    await logActivity({
      user: auth,
      action: 'updated',
      module: 'einvoice',
      description: `E-Invoice ${updated.invoiceNumber} — ${updated.clientNameEn}`,
      amount: totals.totalDue,
    })
    return ok(mapEInvoice(updated))
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      return badRequest('Invoice number already exists — invoice numbers must be unique')
    }
    console.error('[api/e-invoices/[id] PUT]', e)
    return serverError()
  }
}

export async function DELETE(_req: NextRequest, ctx: Ctx) {
  try {
    const auth = await requirePermission('einvoices.delete')
    if (isResponse(auth)) return auth

    const { id } = await ctx.params
    const existing = await db.eInvoice.findUnique({
      where: { id },
      select: { id: true, status: true, invoiceNumber: true, clientNameEn: true },
    })
    if (!existing) return notFound('E-Invoice not found')
    if (existing.status !== 'draft') {
      return badRequest('Issued invoices are locked — use a Credit/Debit Note for corrections')
    }

    await db.eInvoice.delete({ where: { id } })

    await logActivity({
      user: auth,
      action: 'deleted',
      module: 'einvoice',
      description: `E-Invoice ${existing.invoiceNumber} — ${existing.clientNameEn}`,
    })
    return ok({ deleted: true, id })
  } catch (err) {
    console.error('[api/e-invoices/[id] DELETE]', err)
    return serverError()
  }
}
