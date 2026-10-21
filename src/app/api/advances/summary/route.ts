// Advance summary API — headline cards + total advance given per month (last 12 months)
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { round2 } from '@/lib/format'
import { ok, serverError, requirePermission, isResponse } from '@/lib/api-helpers'
import { advanceStatusOf } from '@/lib/advances'

const SHORT_MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
]

export const dynamic = 'force-dynamic'

// GET /api/advances/summary
export async function GET(_req: NextRequest) {
  try {
    const user = await requirePermission('advances.view')
    if (isResponse(user)) return user

    const rows = await db.workerAdvance.findMany({
      select: {
        amount: true,
        deductedAmount: true,
        givenDate: true,
        staffId: true,
        status: true,
      },
    })

    const now = new Date()
    const buckets = new Map<string, { month: number; year: number; given: number; count: number }>()
    for (let i = -11; i <= 0; i += 1) {
      const d = new Date(now.getFullYear(), now.getMonth() + i, 1)
      buckets.set(`${d.getFullYear()}-${d.getMonth()}`, {
        month: d.getMonth() + 1,
        year: d.getFullYear(),
        given: 0,
        count: 0,
      })
    }

    let given = 0
    let deducted = 0
    const workers = new Set<string>()
    let pendingCount = 0
    for (const r of rows) {
      given += r.amount
      deducted += r.deductedAmount
      workers.add(r.staffId)
      if (advanceStatusOf(r.amount, r.deductedAmount) === 'pending') pendingCount += 1
      const key = `${r.givenDate.getFullYear()}-${r.givenDate.getMonth()}`
      const bucket = buckets.get(key)
      if (bucket) {
        bucket.given += r.amount
        bucket.count += 1
      }
    }

    const monthly = Array.from(buckets.entries())
      .sort((a, b) => {
        const [ay, am] = a[0].split('-').map(Number)
        const [by, bm] = b[0].split('-').map(Number)
        return ay - by || am - bm
      })
      .map(([, b]) => ({
        label: `${SHORT_MONTHS[b.month - 1]} ${b.year}`,
        month: b.month,
        year: b.year,
        given: round2(b.given),
        count: b.count,
      }))

    return ok({
      totals: {
        count: rows.length,
        given: round2(given),
        deducted: round2(deducted),
        outstanding: round2(given - deducted),
        workers: workers.size,
        pendingCount,
      },
      monthly,
    })
  } catch {
    return serverError()
  }
}
