// Transactions API — GET (paginated list + totals) / POST (create)
// Payroll-linked transactions (payrollId set) are read-only here — managed by the Payroll module.
import { NextRequest } from 'next/server'
import type { NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { z } from 'zod'
import { db } from '@/lib/db'
import { round2 } from '@/lib/format'
import type { TransactionRow, TransactionType } from '@/lib/types'
import {
  ok,
  badRequest,
  serverError,
  requirePermission,
  isResponse,
  parsePagination,
  paginatedResponse,
  parseDate,
  logActivity,
} from '@/lib/api-helpers'

const txInclude = {
  transactionCategory: { select: { id: true, name: true, type: true } },
  project: { select: { id: true, name: true } },
  operator: { select: { id: true, name: true } },
  spender: { select: { id: true, fullName: true, iqamaId: true } },
} satisfies Prisma.TransactionInclude

type TxWithRelations = Prisma.TransactionGetPayload<{ include: typeof txInclude }>

function mapTransaction(tx: TxWithRelations): TransactionRow {
  return {
    id: tx.id,
    type: tx.type as TransactionType,
    title: tx.title,
    amount: round2(tx.amount),
    transactionDate: tx.transactionDate.toISOString(),
    description: tx.description,
    category: {
      id: tx.transactionCategory.id,
      name: tx.transactionCategory.name,
      type: tx.transactionCategory.type as TransactionType,
    },
    project: tx.project ? { id: tx.project.id, name: tx.project.name } : null,
    operator: tx.operator ? { id: tx.operator.id, name: tx.operator.name } : null,
    payrollId: tx.payrollId,
    spender: tx.spender ? { id: tx.spender.id, fullName: tx.spender.fullName, iqamaId: tx.spender.iqamaId } : null,
    expenseMonth: tx.expenseMonth,
    expenseYear: tx.expenseYear,
    receiptName: tx.receiptName,
    receiptExt: tx.receiptExt,
    receiptSize: tx.receiptSize,
  }
}

function endOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999)
}

const transactionSchema = z.object({
  type: z.enum(['income', 'expense']),
  title: z.string().min(1, 'Title is required'),
  amount: z.coerce.number().positive('Amount must be greater than 0'),
  transactionCategoryId: z.string().min(1, 'Category is required'),
  projectId: z.string().nullable().optional(),
  operatorUserId: z.string().nullable().optional(),
  transactionDate: z.string().min(1, 'Transaction date is required'),
  description: z.string().nullable().optional(),
  // ---- worker expense tracking (Expense List) ----
  // WHO made the expense — null clears it; omitted = not tracked (income / system rows)
  spenderStaffId: z.string().nullable().optional(),
  // Which month the expense belongs to — omitted = derive from the transaction date
  expenseMonth: z.coerce.number().int().min(1, 'Month must be 1-12').max(12, 'Month must be 1-12').nullable().optional(),
  expenseYear: z.coerce.number().int().min(1900, 'Year is out of range').max(2200, 'Year is out of range').nullable().optional(),
})

type TransactionInput = z.infer<typeof transactionSchema>

type ValidatedTransaction = {
  type: TransactionType
  title: string
  amount: number
  transactionCategoryId: string
  projectId: string | null
  operatorUserId: string
  transactionDate: Date
  description: string | null
  spenderStaffId: string | null
  expenseMonth: number | null
  expenseYear: number | null
}

/** Shared body validation for POST/PUT — returns clean values or an error response. */
async function validateTransactionBody(
  body: TransactionInput,
  sessionUserId: string
): Promise<ValidatedTransaction | NextResponse> {
  const title = body.title.trim()
  if (!title) return badRequest('Title is required')

  const category = await db.transactionCategory.findUnique({
    where: { id: body.transactionCategoryId },
  })
  if (!category) return badRequest('Selected category does not exist')
  if (category.type !== body.type) return badRequest('Category type mismatch')

  let projectId: string | null = null
  if (body.projectId) {
    const project = await db.project.findUnique({ where: { id: body.projectId } })
    if (!project) return badRequest('Selected project does not exist')
    projectId = body.projectId
  }

  let operatorUserId = sessionUserId
  if (body.operatorUserId) {
    const operator = await db.user.findUnique({ where: { id: body.operatorUserId } })
    if (!operator) return badRequest('Selected operator does not exist')
    operatorUserId = body.operatorUserId
  }

  const transactionDate = parseDate(body.transactionDate)
  if (!transactionDate) return badRequest('Invalid transaction date')

  // Worker expense tracking — validate the spender and default the month/year
  // from the transaction date when the caller does not specify them.
  let spenderStaffId: string | null = null
  if (body.spenderStaffId) {
    const spender = await db.staff.findFirst({
      where: { id: body.spenderStaffId, deletedAt: null },
      select: { id: true },
    })
    if (!spender) return badRequest('Selected worker does not exist')
    spenderStaffId = body.spenderStaffId
  }
  const expenseMonth =
    body.expenseMonth ?? (body.type === 'expense' ? transactionDate.getMonth() + 1 : null)
  const expenseYear =
    body.expenseYear ?? (body.type === 'expense' ? transactionDate.getFullYear() : null)

  return {
    type: body.type,
    title,
    amount: round2(body.amount),
    transactionCategoryId: body.transactionCategoryId,
    projectId,
    operatorUserId,
    transactionDate,
    description: body.description?.trim() || null,
    spenderStaffId,
    expenseMonth,
    expenseYear,
  }
}

export async function GET(req: NextRequest) {
  try {
    const auth = await requirePermission('accounts.view')
    if (isResponse(auth)) return auth

    const sp = req.nextUrl.searchParams
    const type = sp.get('type')
    if (type !== 'income' && type !== 'expense') {
      return badRequest('type must be income or expense')
    }

    const p = parsePagination(sp)
    const where: Prisma.TransactionWhereInput = { type }

    const categoryId = sp.get('categoryId')
    if (categoryId) where.transactionCategoryId = categoryId
    const projectId = sp.get('projectId')
    if (projectId) where.projectId = projectId
    // Worker expense tracking filters — 'none' = company expenses without a worker
    const spenderId = sp.get('spenderId')?.trim()
    if (spenderId === 'none') where.spenderStaffId = null
    else if (spenderId) where.spenderStaffId = spenderId
    const expenseMonth = Number(sp.get('expenseMonth'))
    if (Number.isInteger(expenseMonth) && expenseMonth >= 1 && expenseMonth <= 12) {
      where.expenseMonth = expenseMonth
    }
    const expenseYear = Number(sp.get('expenseYear'))
    if (Number.isInteger(expenseYear) && expenseYear >= 1900 && expenseYear <= 2200) {
      where.expenseYear = expenseYear
    }
    const search = sp.get('search')?.trim()
    // Multi-field search: title, description, category name, project name and spender name
    if (search) {
      where.OR = [
        { title: { contains: search } },
        { description: { contains: search } },
        { transactionCategory: { name: { contains: search } } },
        { project: { name: { contains: search } } },
        { spender: { fullName: { contains: search } } },
        { spender: { iqamaId: { contains: search } } },
      ]
    }
    const from = parseDate(sp.get('from'))
    const to = parseDate(sp.get('to'))
    if (from || to) {
      where.transactionDate = {
        ...(from ? { gte: from } : {}),
        ...(to ? { lte: endOfDay(to) } : {}),
      }
    }

    const [rows, total, agg] = await Promise.all([
      db.transaction.findMany({
        where,
        orderBy: [{ transactionDate: 'desc' }, { createdAt: 'desc' }],
        skip: p.skip,
        take: p.take,
        include: txInclude,
      }),
      db.transaction.count({ where }),
      db.transaction.aggregate({ where, _sum: { amount: true } }),
    ])

    return paginatedResponse(rows.map(mapTransaction), total, p, {
      sum: round2(agg._sum.amount ?? 0),
    })
  } catch {
    return serverError()
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requirePermission('accounts.create')
    if (isResponse(auth)) return auth

    let raw: unknown
    try {
      raw = await req.json()
    } catch {
      return badRequest('Invalid JSON body')
    }
    const parsed = transactionSchema.safeParse(raw)
    if (!parsed.success) {
      return badRequest(parsed.error.issues[0]?.message ?? 'Invalid request body')
    }
    // NOTE: any payrollId in the body is intentionally ignored —
    // payroll-linked transactions are created/managed only by the payroll module.

    const values = await validateTransactionBody(parsed.data, auth.id)
    if (isResponse(values)) return values

    const created = await db.transaction.create({ data: values, include: txInclude })
    await logActivity({
      user: auth,
      action: 'created',
      module: 'transaction',
      description: `${values.type === 'income' ? 'Income' : 'Expense'}: ${values.title}`,
      amount: values.amount,
    })
    return ok(mapTransaction(created), 201)
  } catch {
    return serverError()
  }
}
