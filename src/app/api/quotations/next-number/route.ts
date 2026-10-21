// Next quote number preview — GET /api/quotations/next-number?prefix=QTN&year=2026.
// Uses the exact same generator as POST /api/quotations so the editor's live
// draft preview can show the number the document will actually receive.
// (Static segment wins over the dynamic [id] route in Next.js routing.)
// Requires quotations.view.
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import {
  ok,
  badRequest,
  serverError,
  requirePermission,
  isResponse,
} from '@/lib/api-helpers'
import { nextQuoteNumber } from '../mappers'

export async function GET(req: NextRequest) {
  try {
    const auth = await requirePermission('quotations.view')
    if (isResponse(auth)) return auth

    const sp = req.nextUrl.searchParams
    const prefix = (sp.get('prefix') ?? 'QTN').trim().toUpperCase()
    if (!/^[A-Z0-9]{1,8}$/.test(prefix)) {
      return badRequest('Prefix must be 1–8 letters or digits')
    }
    const year = parseInt(sp.get('year') ?? '', 10)
    if (!Number.isInteger(year) || year < 1900 || year > 2200) {
      return badRequest('Invalid year')
    }

    const quoteNumber = await db.$transaction((tx) => nextQuoteNumber(tx, year, prefix))
    return ok({ quoteNumber, prefix, year })
  } catch (err) {
    console.error('[api/quotations/next-number GET]', err)
    return serverError()
  }
}
