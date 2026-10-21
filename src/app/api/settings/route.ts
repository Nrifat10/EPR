// Settings API — GET is PUBLIC (login screen needs branding before auth);
// PUT requires settings.edit. Values are stored as key/value rows.
import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import type { PayType } from '@/lib/types'
import {
  ok,
  badRequest,
  serverError,
  requirePermission,
  isResponse,
  logActivity,
} from '@/lib/api-helpers'

export const dynamic = 'force-dynamic'

function buildSettings(map: Record<string, string>) {
  return {
    companyName: map.companyName ?? 'Landmark Inter Gulf',
    companyNameAr: map.companyNameAr ?? 'لاندمارك انتر جلف',
    address:
      map.address ??
      'Al Suwedhi Business Centre, Office # 103, 1st Floor, P.O.Box 35712, Building 5526, 4th Street, Distt. Al Wahah, Jubail, Kingdom of Saudi Arabia',
    addressAr: map.addressAr ?? 'مركز السويدي التجاري، مكتب 103، الدور الأول، ص.ب. 35712، مبنى 5526، الشارع الرابع، حي الوها، الجبيل، المملكة العربية السعودية',
    phone: map.phone ?? '+966 13 847 2200',
    email: map.email ?? 'info@landmarkintergulf.com',
    logo: map.logo ?? '/logo-mark.png', // default brand ML monogram
    currency: map.currency ?? 'SAR',
    defaultPayType: (map.defaultPayType ?? 'bank_transfer') as PayType,
    authorizedSignatory: map.authorizedSignatory ?? '',
    signatoryTitle: map.signatoryTitle ?? 'Authorized Signatory',
    // ZATCA seller identity — QR tag 2 / UBL PartyTaxScheme CompanyID
    vatNumber: map.vatNumber ?? '',
    crNumber: map.crNumber ?? '',
    // Company bank details — printed as payment instructions on invoices
    bankName: map.bankName ?? '',
    bankIban: map.bankIban ?? '',
    bankAccountNumber: map.bankAccountNumber ?? '',
    bankAccountName: map.bankAccountName ?? '',
    bankSwiftCode: map.bankSwiftCode ?? '',
    bankAddress: map.bankAddress ?? '',
    // VAT rate for the VAT Return Expense module — stored as a PERCENT string ("15")
    vatRate: clampVatPercent(parseFloat(map.vatRate ?? '')),
  }
}

/** Sanity-clamp the stored VAT percent to 0–100 (missing/invalid → Saudi standard 15). */
function clampVatPercent(v: number): number {
  if (isNaN(v)) return 15
  return Math.min(100, Math.max(0, v))
}

async function readSettingsMap(): Promise<Record<string, string>> {
  const rows = await db.setting.findMany()
  const map: Record<string, string> = {}
  for (const r of rows) map[r.key] = r.value
  return map
}

const settingsSchema = z.object({
  companyName: z.string().min(1, 'Company name is required').optional(),
  address: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().optional(),
  logo: z.string().nullable().optional(), // data URL or null (clear)
  currency: z.string().min(1, 'Currency is required').optional(),
  defaultPayType: z.enum(['bank_transfer', 'cash', 'cheque']).optional(),
  authorizedSignatory: z.string().max(120).optional(),
  signatoryTitle: z.string().max(120).optional(),
  // ZATCA seller identity (15-digit Saudi VAT number, e.g. 3xxxxxxxxxxxxx3)
  vatNumber: z.string().max(15, 'VAT number cannot exceed 15 digits').optional(),
  crNumber: z.string().max(20).optional(),
  // Company bank details for invoice payment instructions
  bankName: z.string().max(120).optional(),
  bankIban: z.string().max(34, 'IBAN cannot exceed 34 characters').optional(),
  bankAccountNumber: z.string().max(34).optional(),
  bankAccountName: z.string().max(120).optional(),
  bankSwiftCode: z.string().max(20, 'SWIFT code cannot exceed 20 characters').optional(),
  bankAddress: z.string().max(240).optional(),
  // VAT percent 0–100 (15 = Saudi standard); stored under the `vatRate` key
  vatRate: z.coerce.number().min(0, 'VAT rate cannot be negative').max(100, 'VAT rate cannot exceed 100').optional(),
})

export async function GET() {
  try {
    const map = await readSettingsMap()
    return ok({ settings: buildSettings(map) })
  } catch {
    return serverError()
  }
}

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
    const parsed = settingsSchema.safeParse(raw)
    if (!parsed.success) {
      return badRequest(parsed.error.issues[0]?.message ?? 'Invalid request body')
    }
    const body = parsed.data

    const entries: [string, string][] = []
    if (body.companyName !== undefined) entries.push(['companyName', body.companyName])
    if (body.address !== undefined) entries.push(['address', body.address])
    if (body.phone !== undefined) entries.push(['phone', body.phone])
    if (body.email !== undefined) entries.push(['email', body.email])
    if (body.logo !== undefined && body.logo !== null) entries.push(['logo', body.logo])
    if (body.currency !== undefined) entries.push(['currency', body.currency])
    if (body.defaultPayType !== undefined) {
      entries.push(['defaultPayType', body.defaultPayType])
    }
    if (body.authorizedSignatory !== undefined) {
      entries.push(['authorizedSignatory', body.authorizedSignatory])
    }
    if (body.signatoryTitle !== undefined) {
      entries.push(['signatoryTitle', body.signatoryTitle])
    }
    if (body.vatNumber !== undefined) entries.push(['vatNumber', body.vatNumber])
    if (body.crNumber !== undefined) entries.push(['crNumber', body.crNumber])
    if (body.bankName !== undefined) entries.push(['bankName', body.bankName])
    if (body.bankIban !== undefined) entries.push(['bankIban', body.bankIban])
    if (body.bankAccountNumber !== undefined) {
      entries.push(['bankAccountNumber', body.bankAccountNumber])
    }
    if (body.bankAccountName !== undefined) {
      entries.push(['bankAccountName', body.bankAccountName])
    }
    if (body.bankSwiftCode !== undefined) {
      entries.push(['bankSwiftCode', body.bankSwiftCode])
    }
    if (body.bankAddress !== undefined) {
      entries.push(['bankAddress', body.bankAddress])
    }
    if (body.vatRate !== undefined) {
      entries.push(['vatRate', String(clampVatPercent(body.vatRate))])
    }

    for (const [key, value] of entries) {
      await db.setting.upsert({
        where: { key },
        update: { value },
        create: { key, value },
      })
    }
    // logo: null explicitly clears the stored logo
    if (body.logo === null) {
      await db.setting.deleteMany({ where: { key: 'logo' } })
    }

    await logActivity({
      user: auth,
      action: 'updated',
      module: 'settings',
      description: 'System settings updated',
    })

    const map = await readSettingsMap()
    return ok({ settings: buildSettings(map) })
  } catch {
    return serverError()
  }
}
