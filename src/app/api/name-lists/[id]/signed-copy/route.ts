// Signed / stamped client copy API — GET (stream the scan/photo) / POST
// (upload, multipart) / DELETE (remove). Files live on disk under
// <project>/uploads/name-lists and are only served through this
// authenticated route (same pattern as transaction receipts).
import { NextRequest, NextResponse } from 'next/server'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { db } from '@/lib/db'
import {
  badRequest,
  notFound,
  ok,
  serverError,
  requirePermission,
  isResponse,
  logActivity,
} from '@/lib/api-helpers'

type Params = { params: Promise<{ id: string }> }

const DIR = path.join(process.cwd(), 'uploads', 'name-lists')

const ALLOWED: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
}
const MAX_BYTES = 10 * 1024 * 1024 // 10 MB

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

export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const auth = await requirePermission('namelist.view')
    if (isResponse(auth)) return auth

    const { id } = await params
    const list = await db.nameList.findUnique({ where: { id } })
    if (!list) return notFound('Name list not found')
    if (!list.signedCopyExt || !list.signedCopyName) return notFound('No signed copy attached')

    const filePath = path.join(DIR, `${id}.${list.signedCopyExt}`)
    let bytes: Buffer
    try {
      bytes = await fs.readFile(filePath)
    } catch {
      return notFound('Signed copy file is missing on disk')
    }

    return new NextResponse(new Uint8Array(bytes), {
      status: 200,
      headers: {
        'Content-Type': contentTypeFor(list.signedCopyExt),
        'Content-Length': String(bytes.byteLength),
        'Content-Disposition': `inline; filename="${encodeURIComponent(list.signedCopyName)}"`,
        'Cache-Control': 'private, max-age=3600',
      },
    })
  } catch {
    return serverError()
  }
}

export async function POST(req: NextRequest, { params }: Params) {
  try {
    const auth = await requirePermission('namelist.edit')
    if (isResponse(auth)) return auth

    const { id } = await params
    const list = await db.nameList.findUnique({ where: { id } })
    if (!list) return notFound('Name list not found')

    const form = await req.formData()
    const file = form.get('file')
    if (!(file instanceof File)) return badRequest('No file uploaded')
    const ext = ALLOWED[file.type]
    if (!ext) return badRequest('Only JPG, PNG, WebP or PDF files are allowed')
    if (file.size > MAX_BYTES) return badRequest('File is larger than 10 MB')

    const bytes = Buffer.from(await file.arrayBuffer())
    await fs.mkdir(DIR, { recursive: true })
    await fs.writeFile(path.join(DIR, `${id}.${ext}`), bytes)

    await db.nameList.update({
      where: { id },
      data: { signedCopyExt: ext, signedCopyName: file.name },
    })
    await logActivity({
      user: auth,
      action: 'updated',
      module: 'namelist',
      description: `Name List ${list.listNo} — signed copy uploaded (${file.name})`,
    })
    return ok({ uploaded: true, name: file.name })
  } catch {
    return serverError()
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  try {
    const auth = await requirePermission('namelist.edit')
    if (isResponse(auth)) return auth

    const { id } = await params
    const list = await db.nameList.findUnique({ where: { id } })
    if (!list) return notFound('Name list not found')

    if (list.signedCopyExt) {
      try {
        await fs.unlink(path.join(DIR, `${id}.${list.signedCopyExt}`))
      } catch {
        // already gone on disk — fine
      }
    }
    await db.nameList.update({
      where: { id },
      data: { signedCopyExt: null, signedCopyName: null },
    })
    await logActivity({
      user: auth,
      action: 'updated',
      module: 'namelist',
      description: `Name List ${list.listNo} — signed copy removed`,
    })
    return ok({ deleted: true })
  } catch {
    return serverError()
  }
}
