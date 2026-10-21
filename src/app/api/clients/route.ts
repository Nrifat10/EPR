// GET /api/clients (list, paginated, KPI totals) + POST /api/clients (create)
import { NextRequest } from 'next/server'
import { z } from 'zod'
import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import {
  ok,
  badRequest,
  serverError,
  requireAuth,
  requirePermission,
  isResponse,
  parsePagination,
  paginatedResponse,
  logActivity,
} from '@/lib/api-helpers'
import type { ClientRow, ClientStatus } from '@/lib/types'

const CLIENT_STATUSES = ['active', 'inactive']

const nullableTrim = (v: unknown) =>
  typeof v === 'string' ? (v.trim() === '' ? null : v.trim()) : v === undefined ? null : v

export const clientSchema = z.object({
  name: z.preprocess(
    (v) => (typeof v === 'string' ? v.trim() : ''),
    z.string().min(1, 'Client name is required').max(120, 'Client name is too long')
  ),
  nameAr: z.preprocess(nullableTrim, z.string().max(160).nullable()),
  contactPerson: z.preprocess(nullableTrim, z.string().nullable()),
  phone: z.preprocess(nullableTrim, z.string().nullable()),
  email: z.preprocess(nullableTrim, z.string().nullable()),
  address: z.preprocess(nullableTrim, z.string().nullable()),
  addressAr: z.preprocess(nullableTrim, z.string().nullable()),
  city: z.preprocess(nullableTrim, z.string().nullable()),
  crNumber: z.preprocess(nullableTrim, z.string().nullable()),
  // Saudi VAT registration number — 15 digits, starts & ends with 3
  vatNumber: z.preprocess(
    (v) => (typeof v === 'string' ? v.trim().replace(/[\s-]/g, '') || null : v ?? null),
    z
      .string()
      .regex(/^\d{15}$/, 'VAT number must be exactly 15 digits (e.g. 3xxxxxxxxxxxxx3)')
      .nullable()
  ),
  bankName: z.preprocess(nullableTrim, z.string().nullable()),
  iban: z.preprocess(
    (v) => (typeof v === 'string' ? v.replace(/\s/g, '').toUpperCase() : null),
    z.string().max(34).nullable()
  ),
  accountNumber: z.preprocess(nullableTrim, z.string().nullable()),
  swiftCode: z.preprocess(
    (v) => (typeof v === 'string' ? v.replace(/\s/g, '').toUpperCase() : null),
    z.string().max(11).nullable()
  ),
  status: z.preprocess(
    (v) => (v === '' || v === null || v === undefined ? undefined : v),
    z.enum(['active', 'inactive'], { error: 'Status must be active or inactive' }).optional()
  ),
  notes: z.preprocess(nullableTrim, z.string().nullable()),
})

type ClientWithCounts = Prisma.ClientGetPayload<{
  include: {
    _count: { select: { projects: true } }
    projects: { select: { _count: { select: { staff: true } } } }
  }
}>

function toClientRow(c: ClientWithCounts): ClientRow {
  const deployedWorkers = c.projects.reduce((sum, p) => sum + p._count.staff, 0)
  return {
    id: c.id,
    name: c.name,
    nameAr: c.nameAr,
    contactPerson: c.contactPerson,
    phone: c.phone,
    email: c.email,
    address: c.address,
    addressAr: c.addressAr,
    city: c.city,
    crNumber: c.crNumber,
    vatNumber: c.vatNumber,
    bankName: c.bankName,
    iban: c.iban,
    accountNumber: c.accountNumber,
    swiftCode: c.swiftCode,
    status: c.status as ClientStatus,
    notes: c.notes,
    createdAt: c.createdAt.toISOString(),
    projectCount: c._count.projects,
    deployedWorkers,
  }
}

export async function GET(req: NextRequest) {
  try {
    const auth = await requireAuth()
    if (isResponse(auth)) return auth

    const { searchParams } = new URL(req.url)
    const p = parsePagination(searchParams)
    const search = (searchParams.get('search') ?? '').trim()
    const status = (searchParams.get('status') ?? '').trim()

    const where: Prisma.ClientWhereInput = {}
    if (search) {
      where.OR = [
        { name: { contains: search } },
        { nameAr: { contains: search } },
        { contactPerson: { contains: search } },
        { city: { contains: search } },
        { email: { contains: search } },
        { vatNumber: { contains: search } },
      ]
    }
    if (status && CLIENT_STATUSES.includes(status)) where.status = status

    const [total, clients, statusRows] = await Promise.all([
      db.client.count({ where }),
      db.client.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: p.skip,
        take: p.take,
        include: {
          _count: { select: { projects: true } },
          projects: { select: { _count: { select: { staff: true } } } },
        },
      }),
      db.client.groupBy({ by: ['status'], _count: true }),
    ])

    // Company-wide KPI chips (independent of table filters, same pattern as /api/projects)
    const [projectCount, assignmentCount, clientCount] = await Promise.all([
      db.project.count({ where: { clientId: { not: null } } }),
      db.projectStaff.count({ where: { project: { clientId: { not: null } } } }),
      db.client.count(),
    ])
    const totals: Record<string, number> = {
      active: 0,
      inactive: 0,
      projectCount,
      assignments: assignmentCount,
      clientCount,
    }
    for (const row of statusRows) {
      totals[row.status] = row._count
    }

    return paginatedResponse(clients.map(toClientRow), total, p, totals)
  } catch (err) {
    console.error('[api/clients GET]', err)
    return serverError()
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requirePermission('clients.create')
    if (isResponse(auth)) return auth

    let json: unknown = null
    try {
      json = await req.json()
    } catch {
      json = null
    }
    const parsed = clientSchema.safeParse(json)
    if (!parsed.success) {
      return badRequest(parsed.error.issues[0]?.message ?? 'Invalid request data')
    }
    const data = parsed.data

    const duplicate = await db.client.findUnique({ where: { name: data.name } })
    if (duplicate) return badRequest('A client with this name already exists')

    const client = await db.client.create({
      data: {
        name: data.name,
        nameAr: data.nameAr,
        contactPerson: data.contactPerson,
        phone: data.phone,
        email: data.email,
        address: data.address,
        addressAr: data.addressAr,
        city: data.city,
        crNumber: data.crNumber,
        vatNumber: data.vatNumber,
        bankName: data.bankName,
        iban: data.iban,
        accountNumber: data.accountNumber,
        swiftCode: data.swiftCode,
        status: data.status ?? 'active',
        notes: data.notes,
      },
      include: {
        _count: { select: { projects: true } },
        projects: { select: { _count: { select: { staff: true } } } },
      },
    })

    await logActivity({
      user: auth,
      action: 'created',
      module: 'client',
      description: `Created client: ${client.name}`,
    })

    return ok(toClientRow(client), 201)
  } catch (err) {
    console.error('[api/clients POST]', err)
    return serverError()
  }
}
