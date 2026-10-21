// Agreement API — GET / PUT / DELETE a single agreement.
// GET returns the agreement with ALL children (items, installments, clauses)
// ordered by sr. PUT performs a FULL REPLACE of the children inside one
// transaction (delete + recreate with fresh sr ordering) and recomputes the
// contract value server-side for the detailed layout. DELETE cascades to the
// children (schema-level onDelete: Cascade).
import { NextRequest } from 'next/server'
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
import {
  agreementBodySchema,
  agreementFullInclude,
  mapAgreement,
  normalizeAgreementChildren,
  validateAgreementBody,
} from '@/lib/agreement-server'

type Params = { params: Promise<{ id: string }> }

export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const auth = await requirePermission('agreements.view')
    if (isResponse(auth)) return auth
    const { id } = await params

    const agreement = await db.agreement.findUnique({
      where: { id },
      include: agreementFullInclude,
    })
    if (!agreement) return notFound('Agreement not found')
    return ok(mapAgreement(agreement))
  } catch {
    return serverError()
  }
}

export async function PUT(req: NextRequest, { params }: Params) {
  try {
    const auth = await requirePermission('agreements.edit')
    if (isResponse(auth)) return auth
    const { id } = await params

    const existing = await db.agreement.findUnique({ where: { id }, select: { id: true } })
    if (!existing) return notFound('Agreement not found')

    let raw: unknown
    try {
      raw = await req.json()
    } catch {
      return badRequest('Invalid JSON body')
    }
    const parsed = agreementBodySchema.safeParse(raw)
    if (!parsed.success) {
      return badRequest(parsed.error.issues[0]?.message ?? 'Invalid request body')
    }
    const body = parsed.data

    const startDate = parseDate(body.startDate)
    if (!startDate) return badRequest('Invalid start date')
    const endDate = parseDate(body.endDate ?? undefined)

    const validationError = validateAgreementBody(body, startDate, endDate)
    if (validationError) return badRequest(validationError)

    let clientId: string | null = null
    if (body.clientId) {
      const client = await db.client.findUnique({
        where: { id: body.clientId },
        select: { id: true },
      })
      if (!client) return badRequest('Selected client no longer exists')
      clientId = client.id
    }

    const normalized = normalizeAgreementChildren(body)

    // Full replace: header fields updated, children deleted + recreated with
    // deterministic sr ordering — all inside one transaction.
    const updated = await db.$transaction(async (tx) => {
      await tx.agreementItem.deleteMany({ where: { agreementId: id } })
      await tx.agreementInstallment.deleteMany({ where: { agreementId: id } })
      await tx.agreementClause.deleteMany({ where: { agreementId: id } })

      return tx.agreement.update({
        where: { id },
        data: {
          title: body.title.trim(),
          partyA: 'Landmark Inter Gulf LLC',
          clientId,
          clientName: body.clientName.trim(),
          type: body.type ?? 'labor_supply',
          layoutStyle: body.layoutStyle ?? 'detailed',
          startDate,
          endDate,
          status: body.status ?? 'draft',
          value: normalized.value,
          currency: 'SAR',
          notes: body.notes?.trim() || null,
          items: { create: normalized.items },
          installments: { create: normalized.installments },
          clauses: { create: normalized.clauses },
        },
        include: agreementFullInclude,
      })
    })

    await logActivity({
      user: auth,
      action: 'updated',
      module: 'agreement',
      description: `Agreement ${updated.refNumber} — ${updated.title} (${updated.clientName})`,
      amount: updated.value,
    })
    return ok(mapAgreement(updated))
  } catch {
    return serverError()
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  try {
    const auth = await requirePermission('agreements.delete')
    if (isResponse(auth)) return auth
    const { id } = await params

    const existing = await db.agreement.findUnique({
      where: { id },
      select: { id: true, refNumber: true, title: true, clientName: true, value: true },
    })
    if (!existing) return notFound('Agreement not found')

    await db.agreement.delete({ where: { id } })

    await logActivity({
      user: auth,
      action: 'deleted',
      module: 'agreement',
      description: `Agreement ${existing.refNumber} — ${existing.title} (${existing.clientName})`,
      amount: existing.value,
    })
    return ok({ deleted: true })
  } catch {
    return serverError()
  }
}
