// E-Invoice print & translation config API — GET / PUT /api/e-invoice-config
// Setting keys (stored in the shared Setting table):
//   einvoice_letterhead               data URL ('' when unset)
//   einvoice_letterhead_top_mm        '35'
//   einvoice_letterhead_bottom_mm     '22'
//   einvoice_signature                data URL
//   einvoice_stamp                    data URL
//   einvoice_show_receiver_signature  'true'
//   translate_provider                'builtin' | 'google' | 'deepl'
//   translate_api_key                 (never returned — only a boolean flag)
import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import {
  ok,
  badRequest,
  serverError,
  requirePermission,
  isResponse,
  logActivity,
} from '@/lib/api-helpers'
import { validateImageDataUrl } from '@/lib/image-data-url'

const KEYS = [
  'einvoice_letterhead',
  'einvoice_letterhead_top_mm',
  'einvoice_letterhead_bottom_mm',
  'einvoice_signature',
  'einvoice_stamp',
  'einvoice_show_receiver_signature',
  'translate_provider',
  'translate_api_key',
] as const

const DEFAULTS: Record<(typeof KEYS)[number], string> = {
  einvoice_letterhead: '',
  einvoice_letterhead_top_mm: '35',
  einvoice_letterhead_bottom_mm: '22',
  einvoice_signature: '',
  einvoice_stamp: '',
  einvoice_show_receiver_signature: 'true',
  translate_provider: 'builtin',
  translate_api_key: '',
}

function clampMm(v: string, fallback: number): number {
  const n = parseInt(v, 10)
  if (!Number.isFinite(n)) return fallback
  return Math.min(100, Math.max(0, n))
}

async function readConfigMap(): Promise<Record<string, string>> {
  const rows = await db.setting.findMany({ where: { key: { in: [...KEYS] } } })
  const map: Record<string, string> = {}
  for (const r of rows) map[r.key] = r.value
  return map
}

/** Upsert (value) or remove (null) one Setting row. */
async function writeSetting(key: string, value: string | null): Promise<void> {
  if (value === null) {
    await db.setting.deleteMany({ where: { key } })
    return
  }
  await db.setting.upsert({
    where: { key },
    update: { value },
    create: { key, value },
  })
}

export async function GET() {
  try {
    const auth = await requirePermission('settings.view')
    if (isResponse(auth)) return auth

    const map = await readConfigMap()
    return ok({
      letterhead: map.einvoice_letterhead ?? DEFAULTS.einvoice_letterhead,
      topMm: clampMm(map.einvoice_letterhead_top_mm ?? DEFAULTS.einvoice_letterhead_top_mm, 35),
      bottomMm: clampMm(map.einvoice_letterhead_bottom_mm ?? DEFAULTS.einvoice_letterhead_bottom_mm, 22),
      signature: map.einvoice_signature ?? DEFAULTS.einvoice_signature,
      stamp: map.einvoice_stamp ?? DEFAULTS.einvoice_stamp,
      showReceiverSignature: (map.einvoice_show_receiver_signature ?? DEFAULTS.einvoice_show_receiver_signature) === 'true',
      translateProvider: map.translate_provider ?? DEFAULTS.translate_provider,
      translateApiKeySet: Boolean((map.translate_api_key ?? '').trim()),
    })
  } catch (err) {
    console.error('[api/e-invoice-config GET]', err)
    return serverError()
  }
}

const configSchema = z.object({
  letterhead: z.string().nullable().optional(),
  topMm: z.coerce.number().min(0, 'Top margin cannot be negative').max(100, 'Top margin cannot exceed 100 mm').optional(),
  bottomMm: z.coerce.number().min(0, 'Bottom margin cannot be negative').max(100, 'Bottom margin cannot exceed 100 mm').optional(),
  signature: z.string().nullable().optional(),
  stamp: z.string().nullable().optional(),
  showReceiverSignature: z.boolean().optional(),
  translateProvider: z.enum(['builtin', 'google', 'deepl']).optional(),
  translateApiKey: z.string().nullable().optional(),
})

export async function PUT(req: NextRequest) {
  try {
    const auth = await requirePermission('settings.edit')
    if (isResponse(auth)) return auth

    let raw: unknown
    try {
      raw = await req.json()
    } catch {
      return badRequest('Invalid JSON body')
    }
    const parsed = configSchema.safeParse(raw)
    if (!parsed.success) {
      return badRequest(parsed.error.issues[0]?.message ?? 'Invalid request body')
    }
    const body = parsed.data

    // Image fields: '' / null clears; anything else must be a valid PNG/JPEG ≤ 2 MB
    const imageFields: [key: 'letterhead' | 'signature' | 'stamp', value: string | null | undefined][] = [
      ['letterhead', body.letterhead],
      ['signature', body.signature],
      ['stamp', body.stamp],
    ]
    for (const [field, value] of imageFields) {
      if (value === undefined) continue
      if (value === null || value === '') {
        await writeSetting(`einvoice_${field}`, null)
        continue
      }
      const valid = validateImageDataUrl(value)
      if (!valid) {
        return badRequest(
          `${field === 'letterhead' ? 'Letterhead' : field === 'signature' ? 'Signature' : 'Stamp'} must be a PNG or JPEG image of at most 2 MB`
        )
      }
      await writeSetting(`einvoice_${field}`, valid.dataUrl)
    }

    if (body.topMm !== undefined) {
      await writeSetting('einvoice_letterhead_top_mm', String(Math.round(body.topMm)))
    }
    if (body.bottomMm !== undefined) {
      await writeSetting('einvoice_letterhead_bottom_mm', String(Math.round(body.bottomMm)))
    }
    if (body.showReceiverSignature !== undefined) {
      await writeSetting('einvoice_show_receiver_signature', body.showReceiverSignature ? 'true' : 'false')
    }
    if (body.translateProvider !== undefined) {
      await writeSetting('translate_provider', body.translateProvider)
    }
    // '' / null clears the key; undefined keeps the existing one
    if (body.translateApiKey !== undefined) {
      const key = body.translateApiKey?.trim() ?? ''
      await writeSetting('translate_api_key', key === '' ? null : key)
    }

    await logActivity({
      user: auth,
      action: 'update',
      module: 'settings',
      description: 'E-Invoice print & translation settings updated',
    })

    const map = await readConfigMap()
    return ok({
      letterhead: map.einvoice_letterhead ?? DEFAULTS.einvoice_letterhead,
      topMm: clampMm(map.einvoice_letterhead_top_mm ?? DEFAULTS.einvoice_letterhead_top_mm, 35),
      bottomMm: clampMm(map.einvoice_letterhead_bottom_mm ?? DEFAULTS.einvoice_letterhead_bottom_mm, 22),
      signature: map.einvoice_signature ?? DEFAULTS.einvoice_signature,
      stamp: map.einvoice_stamp ?? DEFAULTS.einvoice_stamp,
      showReceiverSignature: (map.einvoice_show_receiver_signature ?? DEFAULTS.einvoice_show_receiver_signature) === 'true',
      translateProvider: map.translate_provider ?? DEFAULTS.translate_provider,
      translateApiKeySet: Boolean((map.translate_api_key ?? '').trim()),
    })
  } catch (err) {
    console.error('[api/e-invoice-config PUT]', err)
    return serverError()
  }
}
