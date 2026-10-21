// Client salary summary bulk-rate API — apply one client rate (and optional OT
// rate) to EVERY payroll row of a project for the given month/year in a single
// call. Powers the "apply rate to all workers" control in the Client Salary
// Summary (entering 14 rates one by one is tedious when they are all the same).
//   PUT { month, year, projectId, clientRate, clientOtRate? }
// Only rows with hours or OT hours are touched when `onlyWithHours=true`
// (default). Permission: payroll.edit.
import { NextRequest } from 'next/server'
import { z } from 'zod'
import type { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
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
  month: z.coerce.number().int().min(1, 'Month must be between 1 and 12').max(12, 'Month must be between 1 and 12'),
  year: z.coerce.number().int().min(1900, 'Year is out of range').max(2200, 'Year is out of range'),
  projectId: z.string().min(1, 'Project is required'),
  clientRate: z.coerce.number().min(0, 'Rate cannot be negative').max(100000, 'Rate is out of range'),
  clientOtRate: z.coerce.number().min(0, 'OT rate cannot be negative').max(100000, 'OT rate is out of range').optional(),
  onlyWithHours: z.coerce.boolean().optional().default(true),
})

// PUT /api/clients/salary-summary/rates
export async function PUT(req: NextRequest) {
  try {
    const user = await requirePermission('payroll.edit')
    if (isResponse(user)) return user

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

    const project = await db.project.findUnique({
      where: { id: input.projectId },
      select: { id: true, name: true },
    })
    if (!project) return notFound('Project not found')

    const where: Prisma.PayrollWhereInput = {
      projectId: input.projectId,
      month: input.month,
      year: input.year,
      ...(input.onlyWithHours
        ? { OR: [{ totalHours: { gt: 0 } }, { overtimeHours: { gt: 0 } }] }
        : {}),
    }

    const data: Prisma.PayrollUpdateManyMutationInput = { clientRate: input.clientRate }
    if (input.clientOtRate !== undefined) data.clientOtRate = input.clientOtRate

    const result = await db.payroll.updateMany({ where, data })

    await logActivity({
      user,
      module: 'payroll',
      action: 'updated',
      description: `Client billing rate applied to ${result.count} worker${result.count === 1 ? '' : 's'} — ${project.name} · ${input.month}/${input.year}: ${input.clientRate}/h regular${input.clientOtRate !== undefined ? `, ${input.clientOtRate}/h OT` : ''}`,
    })

    return ok({
      updated: result.count,
      projectId: input.projectId,
      clientRate: input.clientRate,
      clientOtRate: input.clientOtRate ?? null,
    })
  } catch {
    return serverError()
  }
}
