// Transaction [id] API — PUT / DELETE
// Payroll-linked transactions cannot be edited or deleted here (409 → use Payroll module).
import { NextRequest } from 'next/server'
import type { NextResponse } from 'next/server'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { Prisma } from '@prisma/client'
import { z } from 'zod'
import { db } from '@/lib/db'
import { round2 } from '@/lib/format'
import type { TransactionRow, TransactionType } from '@/lib/types'
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

const PAYROLL_LINKED_MSG =
  'This transaction is linked to a payroll and must be managed from the Payroll module.'

/** Project-root receipts directory (kept in sync with the receipt route). */
const RECEIPTS_DIR = path.join(process.cwd(), 'uploads', 'receipts')

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
  spenderStaffId: z.string().nullable().optional(),
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

/** Shared body validation — returns clean values or an error response. */
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

// GET /api/transactions/[id] — fetch a single transaction (accounts.view).
// Used by the command palette record search to deep-open a transaction in its list.
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requirePermission('accounts.view')
    if (isResponse(auth)) return auth

    const { id } = await params
    const tx = await db.transaction.findUnique({ where: { id }, include: txInclude })
    if (!tx) return notFound('Transaction not found')
    return ok(mapTransaction(tx))
  } catch {
    return serverError()
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requirePermission('accounts.edit')
    if (isResponse(auth)) return auth

    const { id } = await params
    const existing = await db.transaction.findUnique({ where: { id } })
    if (!existing) return notFound('Transaction not found')
    if (existing.payrollId) return conflict(PAYROLL_LINKED_MSG)

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
    // any payrollId in the body is intentionally ignored (payroll module owns that link)

    const values = await validateTransactionBody(parsed.data, auth.id)
    if (isResponse(values)) return values

    const updated = await db.transaction.update({
      where: { id },
      data: {
        ...values,
        // Receipt metadata is owned by the receipt endpoint — never touched here
        receiptExt: existing.receiptExt,
        receiptName: existing.receiptName,
        receiptSize: existing.receiptSize,
      },
      include: txInclude,
    })
    await logActivity({
      user: auth,
      action: 'updated',
      module: 'transaction',
      description: `${values.type === 'income' ? 'Income' : 'Expense'}: ${values.title}`,
      amount: values.amount,
    })
    return ok(mapTransaction(updated))
  } catch {
    return serverError()
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requirePermission('accounts.delete')
    if (isResponse(auth)) return auth

    const { id } = await params
    const existing = await db.transaction.findUnique({ where: { id } })
    if (!existing) return notFound('Transaction not found')
    if (existing.payrollId) return conflict(PAYROLL_LINKED_MSG)

    // Remove the attached bill receipt file (best-effort) along with the row
    if (existing.receiptExt) {
      await fs.rm(path.join(RECEIPTS_DIR, `${id}.${existing.receiptExt}`), { force: true })
    }
    await db.transaction.delete({ where: { id } })
    await logActivity({
      user: auth,
      action: 'deleted',
      module: 'transaction',
      description: `${existing.type === 'income' ? 'Income' : 'Expense'}: ${existing.title}`,
      amount: round2(existing.amount),
    })
    return ok({ success: true })
  } catch {
    return serverError()
  }
}
