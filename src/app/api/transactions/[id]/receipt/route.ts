// Transaction receipt API — GET (stream the bill receipt) / POST (upload) / DELETE (remove)
// Files live on disk under <project>/uploads/receipts and are only served through
// this authenticated route (cookies ride along for <img>/fetch same-origin usage).
// Payroll-linked transactions cannot carry receipts here (managed by the Payroll module).
import { NextRequest, NextResponse } from 'next/server'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { db } from '@/lib/db'
import { round2 } from '@/lib/format'
import {
  badRequest,
  conflict,
  notFound,
  ok,
  serverError,
  requirePermission,
  isResponse,
  logActivity,
} from '@/lib/api-helpers'

const PAYROLL_LINKED_MSG =
  'This transaction is linked to a payroll and must be managed from the Payroll module.'

/** Project-root uploads directory (created on demand). */
const RECEIPTS_DIR = path.join(process.cwd(), 'uploads', 'receipts')

const ALLOWED: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
}
const MAX_BYTES = 5 * 1024 * 1024 // 5 MB

function contentTypeFor(ext: string): string {
  switch (ext) {
    case 'jpg':
      return 'image/jpeg'
    case 'png':
      return 'image/png'
    case 'webp':
      return 'image/webp'
    case 'pdf':
      return 'application/pdf'
    default:
      return 'application/octet-stream'
  }
}

// GET /api/transactions/[id]/receipt — stream the attached bill receipt
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requirePermission('accounts.view')
    if (isResponse(auth)) return auth

    const { id } = await params
    const tx = await db.transaction.findUnique({ where: { id } })
    if (!tx) return notFound('Transaction not found')
    if (!tx.receiptExt || !tx.receiptName) return notFound('No receipt attached')

    const filePath = path.join(RECEIPTS_DIR, `${id}.${tx.receiptExt}`)
    let bytes: Buffer
    try {
      bytes = await fs.readFile(filePath)
    } catch {
      return notFound('Receipt file is missing on disk')
    }

    return new NextResponse(new Uint8Array(bytes), {
      status: 200,
      headers: {
        'Content-Type': contentTypeFor(tx.receiptExt),
        'Content-Length': String(bytes.byteLength),
        'Content-Disposition': `inline; filename="${encodeURIComponent(tx.receiptName)}"`,
        'Cache-Control': 'private, max-age=3600',
      },
    })
  } catch {
    return serverError()
  }
}

// POST /api/transactions/[id]/receipt — attach/replace the bill receipt (multipart form)
export async function POST(
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

    let form: FormData
    try {
      form = await req.formData()
    } catch {
      return badRequest('Expected a multipart form upload')
    }
    const file = form.get('file')
    if (!(file instanceof File)) return badRequest('No file uploaded')
    if (file.size === 0) return badRequest('The uploaded file is empty')
    if (file.size > MAX_BYTES) return badRequest('Receipt must be 5 MB or smaller')

    const ext = ALLOWED[file.type] ?? (file.name.toLowerCase().endsWith('.pdf') ? 'pdf' : undefined)
    if (!ext) return badRequest('Only JPG, PNG, WebP images or PDF files are allowed')

    await fs.mkdir(RECEIPTS_DIR, { recursive: true })
    const bytes = Buffer.from(await file.arrayBuffer())
    // Replace = remove any previous file for this transaction first
    for (const old of ['jpg', 'png', 'webp', 'pdf']) {
      if (old !== ext) {
        await fs.rm(path.join(RECEIPTS_DIR, `${id}.${old}`), { force: true })
      }
    }
    await fs.writeFile(path.join(RECEIPTS_DIR, `${id}.${ext}`), bytes)

    const updated = await db.transaction.update({
      where: { id },
      data: {
        receiptExt: ext,
        receiptName: file.name.slice(0, 180),
        receiptSize: file.size,
      },
    })

    await logActivity({
      user: auth,
      action: 'updated',
      module: 'transaction',
      description: `Receipt attached: ${updated.title}`,
      amount: round2(updated.amount),
    })

    return ok({
      receiptName: updated.receiptName,
      receiptExt: updated.receiptExt,
      receiptSize: updated.receiptSize,
      url: `/api/transactions/${id}/receipt`,
    })
  } catch (err) {
    console.error('[api/transactions receipt POST]', err)
    return serverError()
  }
}

// DELETE /api/transactions/[id]/receipt — remove the attached bill receipt
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requirePermission('accounts.edit')
    if (isResponse(auth)) return auth

    const { id } = await params
    const existing = await db.transaction.findUnique({ where: { id } })
    if (!existing) return notFound('Transaction not found')
    if (existing.payrollId) return conflict(PAYROLL_LINKED_MSG)
    if (!existing.receiptExt) return badRequest('No receipt attached')

    await fs.rm(path.join(RECEIPTS_DIR, `${id}.${existing.receiptExt}`), { force: true })
    await db.transaction.update({
      where: { id },
      data: { receiptExt: null, receiptName: null, receiptSize: null },
    })

    await logActivity({
      user: auth,
      action: 'updated',
      module: 'transaction',
      description: `Receipt removed: ${existing.title}`,
      amount: round2(existing.amount),
    })

    return ok({ success: true })
  } catch (err) {
    console.error('[api/transactions receipt DELETE]', err)
    return serverError()
  }
}
