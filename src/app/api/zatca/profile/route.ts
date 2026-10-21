// ZATCA connection profile API — GET / PUT.
// GET  (einvoices.view) → the Phase 2 gateway profile (env, EGS serial,
//                         apiBase, last connection test, csidTokenSet flag —
//                         the raw CSID token NEVER leaves the server).
// PUT  (settings.edit)  → update env / EGS serial / CSID token / apiBase.
//   • csidToken: '' (or omitted) keeps the existing token; null clears it.
//   • apiBase: '' or null resets to the per-environment gateway default.
import { NextRequest } from 'next/server'
import { z } from 'zod'
import {
  ok,
  badRequest,
  serverError,
  requirePermission,
  isResponse,
  logActivity,
} from '@/lib/api-helpers'
import { readZatcaProfile, writeZatcaSetting } from '@/lib/zatca'

export const dynamic = 'force-dynamic'

const profileSchema = z.object({
  env: z.enum(['simulation', 'preprod', 'production']).optional(),
  egsSerial: z.string().trim().max(120, 'EGS serial cannot exceed 120 characters').optional(),
  // '' = keep the existing token · null = clear it · string = replace it
  csidToken: z.string().trim().max(4000, 'CSID token cannot exceed 4000 characters').nullable().optional(),
  // '' / null = fall back to the per-environment gateway default
  apiBase: z.string().trim().max(300, 'Gateway URL cannot exceed 300 characters').nullable().optional(),
})

export async function GET() {
  try {
    const auth = await requirePermission('einvoices.view')
    if (isResponse(auth)) return auth
    return ok(await readZatcaProfile())
  } catch {
    return serverError()
  }
}

export async function PUT(req: NextRequest) {
  try {
    // Same permission as the Settings route — the ZATCA profile is a settings
    // concern (kept in the Setting table under zatca_* keys).
    const auth = await requirePermission('settings.edit')
    if (isResponse(auth)) return auth

    let raw: unknown
    try {
      raw = await req.json()
    } catch {
      return badRequest('Invalid JSON body')
    }
    const parsed = profileSchema.safeParse(raw)
    if (!parsed.success) {
      return badRequest(parsed.error.issues[0]?.message ?? 'Invalid request body')
    }
    const body = parsed.data

    // env must be stored first-class so the per-env apiBase default tracks it
    if (body.env !== undefined) {
      await writeZatcaSetting('zatca_env', body.env)
    }
    if (body.egsSerial !== undefined) {
      await writeZatcaSetting('zatca_egs_serial', body.egsSerial)
    }
    if (body.csidToken !== undefined && body.csidToken !== '') {
      // '' keeps the existing token (never blank it by accident); null clears
      await writeZatcaSetting('zatca_csid_token', body.csidToken)
    }
    if (body.apiBase !== undefined) {
      await writeZatcaSetting('zatca_api_base', body.apiBase === '' ? null : body.apiBase)
    }

    await logActivity({
      user: auth,
      action: 'updated',
      module: 'settings',
      description: `ZATCA connection profile updated (${body.env ? `env: ${body.env}` : 'fields'}${body.csidToken ? ', CSID token set' : ''})`,
    })

    return ok(await readZatcaProfile())
  } catch {
    return serverError()
  }
}
