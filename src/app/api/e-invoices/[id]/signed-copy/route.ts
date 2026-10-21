// E-Invoice signed-copy API — PUT (upload) / DELETE (clear).
// Scanned signed copy uploaded AFTER issuing (proof of delivery). Works EVEN
// WHEN THE INVOICE IS LOCKED — uploading does not modify invoice content.
// Images validated PNG/JPEG ≤ 2 MB (magic bytes, shared util).
import { NextRequest } from 'next/server'
import { z } from 'zod'
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
import { validateImageDataUrl } from '@/lib/image-data-url'

type Ctx = { params: Promise<{ id: string }> }

const bodySchema = z.object({
  image: z.string().min(22, 'Signed copy image is required'),
})

export async function PUT(req: NextRequest, ctx: Ctx) {
  try {
    const auth = await requirePermission('einvoices.edit')
    if (isResponse(auth)) return auth

    const { id } = await ctx.params
    const inv = await db.eInvoice.findUnique({
      where: { id },
      select: { id: true, invoiceNumber: true },
    })
    if (!inv) return notFound('E-Invoice not found')

    let raw: unknown
    try {
      raw = await req.json()
    } catch {
      return badRequest('Invalid JSON body')
    }
    const parsed = bodySchema.safeParse(raw)
    if (!parsed.success) {
      return badRequest(parsed.error.issues[0]?.message ?? 'Invalid request body')
    }

    const valid = validateImageDataUrl(parsed.data.image)
    if (!valid) {
      return badRequest('Signed copy must be a PNG or JPEG image of at most 2 MB')
    }

    await db.eInvoice.update({ where: { id }, data: { signedCopyImage: valid.dataUrl } })

    await logActivity({
      user: auth,
      action: 'updated',
      module: 'einvoice',
      description: `Signed copy uploaded for ${inv.invoiceNumber}`,
    })
    return ok({ signedCopyImage: valid.dataUrl })
  } catch (err) {
    console.error('[api/e-invoices/[id]/signed-copy PUT]', err)
    return serverError()
  }
}

export async function DELETE(_req: NextRequest, ctx: Ctx) {
  try {
    const auth = await requirePermission('einvoices.edit')
    if (isResponse(auth)) return auth

    const { id } = await ctx.params
    const inv = await db.eInvoice.findUnique({
      where: { id },
      select: { id: true, invoiceNumber: true, signedCopyImage: true },
    })
    if (!inv) return notFound('E-Invoice not found')

    await db.eInvoice.update({ where: { id }, data: { signedCopyImage: null } })

    await logActivity({
      user: auth,
      action: 'updated',
      module: 'einvoice',
      description: `Signed copy removed from ${inv.invoiceNumber}`,
    })
    return ok({ signedCopyImage: null })
  } catch (err) {
    console.error('[api/e-invoices/[id]/signed-copy DELETE]', err)
    return serverError()
  }
}
