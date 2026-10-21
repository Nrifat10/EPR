// Payroll client-rate API — lightweight editor for the CLIENT BILLING rates
// stored on a payroll record (clientRate / clientOtRate). Used by the Client
// Salary Summary view: hours mirror Payroll for the month, while the rate we
// charge the client company is entered manually per worker (it is distinct
// from the worker's own pay rate — hourlyRateSnapshot / overtimeRateSnapshot
// are never touched by this endpoint).
//   PUT { clientRate?: number, clientOtRate?: number }  — 0 clears back to the
//   project default / regular-rate fallback. Permission: payroll.edit.
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
  logActivity,
} from '@/lib/api-helpers'

const bodySchema = z.object({
  clientRate: z.coerce.number().min(0, 'Rate cannot be negative').max(100000, 'Rate is out of range').optional(),
  clientOtRate: z.coerce.number().min(0, 'OT rate cannot be negative').max(100000, 'OT rate is out of range').optional(),
})

type Params = { params: Promise<{ id: string }> }

// PUT /api/payrolls/[id]/client-rate
export async function PUT(req: NextRequest, { params }: Params) {
  try {
    const user = await requirePermission('payroll.edit')
    if (isResponse(user)) return user

    const { id } = await params
    const existing = await db.payroll.findUnique({
      where: { id },
      include: {
        staff: { select: { fullName: true } },
        project: { select: { name: true, clientRatePerHour: true } },
      },
    })
    if (!existing) return notFound('Payroll record not found')

    let body: unknown
    try {
      body = await req.json()
    } catch {
      return badRequest('Invalid JSON body')
    }

    const parsed = bodySchema.safeParse(body)
    if (!parsed.success) {
      const first = parsed.error.issues[0]
      return badRequest(first ? `${first.path.join('.') || 'body'}: ${first.message}` : 'Invalid request body')
    }
    const input = parsed.data

    // Both omitted → nothing to do
    if (input.clientRate === undefined && input.clientOtRate === undefined) {
      return badRequest('Provide clientRate and/or clientOtRate to update')
    }

    const clientRate = input.clientRate ?? existing.clientRate
    const clientOtRate = input.clientOtRate ?? existing.clientOtRate

    const updated = await db.payroll.update({
      where: { id },
      data: { clientRate, clientOtRate },
    })

    await logActivity({
      user,
      module: 'payroll',
      action: 'updated',
      description: `Client billing rate ${existing.staff?.fullName ?? 'worker'} — ${existing.month}/${existing.year}${existing.project ? ` (${existing.project.name})` : ''}: ${round2(clientRate)}/h regular, ${round2(clientOtRate)}/h OT`,
    })

    return ok({
      payrollId: updated.id,
      clientRate: updated.clientRate,
      clientOtRate: updated.clientOtRate,
    })
  } catch {
    return serverError()
  }
}
