// Duplicate a quotation — POST /api/quotations/[id]/duplicate.
// Copies items, notes, terms and signature/stamp assets (with their exact
// positions) into a brand-new DRAFT quotation with the next auto number.
// Requires quotations.create (it creates a new document).
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
import { mapQuotation, quoteInclude, nextQuoteNumber } from '../../mappers'

type Params = { params: Promise<{ id: string }> }

export async function POST(_req: NextRequest, { params }: Params) {
  try {
    const auth = await requirePermission('quotations.create')
    if (isResponse(auth)) return auth
    const { id } = await params

    const source = await db.quotation.findUnique({
      where: { id },
      include: { items: true, assets: true },
    })
    if (!source) return notFound('Quotation not found')

    // Derive the prefix from the source number (QTN-2026-0007 → QTN) so a
    // duplicate keeps the same series.
    const m = /^([A-Za-z0-9]+)-\d{4}-\d+$/.exec(source.quoteNumber)
    const prefix = m ? m[1].toUpperCase() : 'QTN'

    const created = await db.$transaction(async (tx) => {
      const quoteNumber = await nextQuoteNumber(tx, new Date().getFullYear(), prefix)
      return tx.quotation.create({
        data: {
          quoteNumber,
          clientId: source.clientId,
          clientName: source.clientName,
          subject: source.subject,
          referenceNo: source.referenceNo,
          issueDate: new Date(),
          validityDate: source.validityDate,
          status: 'draft', // duplicates always start as drafts
          subtotal: source.subtotal,
          discount: source.discount,
          vatRate: source.vatRate,
          vatAmount: source.vatAmount,
          total: source.total,
          notes: source.notes,
          terms: source.terms,
          projectName: source.projectName,
          projectLocation: source.projectLocation,
          contractPeriod: source.contractPeriod,
          contractMonths: source.contractMonths,
          mobilization: source.mobilization,
          inclusions: source.inclusions,
          exclusions: source.exclusions,
          createdByName: auth.name,
          items: {
            create: [...source.items]
              .sort((a, b) => a.sr - b.sr)
              .map((it) => ({
                sr: it.sr,
                description: it.description,
                unit: it.unit,
                quantity: it.quantity,
                unitPrice: it.unitPrice,
                discount: it.discount,
                lineTotal: it.lineTotal,
                subText: it.subText,
                ratePerHour: it.ratePerHour,
                hoursPerMonth: it.hoursPerMonth,
              })),
          },
          assets: source.assets.length
            ? {
                create: source.assets.map((a) => ({
                  type: a.type,
                  dataUrl: a.dataUrl,
                  posX: a.posX,
                  posY: a.posY,
                  width: a.width,
                  rotation: a.rotation,
                  visible: a.visible,
                })),
              }
            : undefined,
        },
        include: { ...quoteInclude, items: true },
      })
    })

    await logActivity({
      user: auth,
      action: 'created',
      module: 'quotation',
      description: `Quotation ${created.quoteNumber} duplicated from ${source.quoteNumber} — ${source.clientName}`,
      amount: created.total,
    })
    return ok(mapQuotation(created, true), 201)
  } catch (err) {
    console.error('[api/quotations/[id]/duplicate POST]', err)
    return serverError()
  }
}
