// GET /api/backup — full data export as a JSON download (admin-only).
// Settings-permission gated. Passwords and sessions are NEVER included.
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import {
  requirePermission,
  isResponse,
  logActivity,
} from '@/lib/api-helpers'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  try {
    const auth = await requirePermission('settings.edit')
    if (isResponse(auth)) return auth

    const [
      settings,
      roles,
      users,
      clients,
      projects,
      staffCategories,
      staff,
      projectStaff,
      attendance,
      payrolls,
      transactionCategories,
      transactions,
      activityLog,
    ] = await Promise.all([
      db.setting.findMany(),
      db.role.findMany(),
      // sanitized: no password hashes, no session tokens
      db.user.findMany({
        select: {
          id: true, name: true, email: true, avatar: true, isActive: true,
          roleId: true, createdAt: true, updatedAt: true,
        },
      }),
      db.client.findMany(),
      db.project.findMany(),
      db.staffCategory.findMany(),
      db.staff.findMany(),
      db.projectStaff.findMany(),
      db.attendance.findMany(),
      db.payroll.findMany(),
      db.transactionCategory.findMany(),
      db.transaction.findMany(),
      db.activityLog.findMany(),
    ])

    const backup = {
      meta: {
        app: 'Landmark Inter Gulf — Workforce, Payroll & Accounts',
        format: 'lig-backup/1',
        generatedAt: new Date().toISOString(),
        counts: {
          settings: settings.length,
          roles: roles.length,
          users: users.length,
          clients: clients.length,
          projects: projects.length,
          staffCategories: staffCategories.length,
          staff: staff.length,
          projectStaff: projectStaff.length,
          attendance: attendance.length,
          payrolls: payrolls.length,
          transactionCategories: transactionCategories.length,
          transactions: transactions.length,
          activityLog: activityLog.length,
        },
      },
      settings,
      roles,
      users,
      clients,
      projects,
      staffCategories,
      staff,
      projectStaff,
      attendance,
      payrolls,
      transactionCategories,
      transactions,
      activityLog,
    }

    await logActivity({
      user: auth,
      action: 'export',
      module: 'settings',
      description: 'Downloaded full data backup (JSON)',
    })

    const date = new Date().toISOString().slice(0, 10)
    return new NextResponse(JSON.stringify(backup, null, 2), {
      status: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="lig-backup-${date}.json"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (err) {
    console.error('[api/backup GET]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
