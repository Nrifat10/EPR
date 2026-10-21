// First-run setup endpoint.
//
// GET  — reports whether the database has no users yet (needsBootstrap).
// POST — used ONLY on a brand-new install: creates the system ROLES, the
//        DEFAULT SETTINGS and the FIRST ADMINISTRATOR account from the
//        owner's own credentials. It never seeds demo data. Once any user
//        exists it refuses with 409, so it cannot be abused on a live system.
import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { hashPassword } from '@/lib/auth'
import { ok, badRequest, conflict, serverError, logActivity } from '@/lib/api-helpers'
import type { SessionUser } from '@/lib/types'

export const dynamic = 'force-dynamic'

const bodySchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, 'Name must be at least 2 characters')
    .max(80, 'Name is too long'),
  email: z.email('Enter a valid email address').max(120, 'Email is too long').transform((v) => v.toLowerCase()),
  password: z.string().min(8, 'Password must be at least 8 characters').max(72, 'Password is too long'),
})

export async function GET() {
  try {
    const userCount = await db.user.count()
    return ok({ needsBootstrap: userCount === 0, userCount })
  } catch (err) {
    console.error('[api/bootstrap GET]', err)
    return serverError()
  }
}

export async function POST(req: NextRequest) {
  try {
    const userCount = await db.user.count()
    if (userCount > 0) {
      return conflict('The system is already initialized — sign in with your administrator account')
    }

    let json: unknown = null
    try {
      json = await req.json()
    } catch {
      json = null
    }
    const parsed = bodySchema.safeParse(json)
    if (!parsed.success) {
      return badRequest(parsed.error.issues[0]?.message ?? 'Invalid request data')
    }
    const { name, email, password } = parsed.data

    // ---------- System roles (same permission presets the app expects) ----------
    await db.role.createMany({
      data: [
        {
          name: 'Super Admin',
          description: 'Full system access and user management',
          permissions: JSON.stringify(['*']),
        },
        {
          name: 'Accountant',
          description: 'Accounts, payroll and financial reports',
          permissions: JSON.stringify([
            'dashboard.view', 'projects.view', 'staff.view', 'attendance.view',
            'payroll.view', 'payroll.edit', 'payroll.create', 'payroll.delete',
            'accounts.view', 'accounts.edit', 'accounts.create', 'accounts.delete',
            'clients.view', 'activity.view',
          ]),
        },
        {
          name: 'HR Manager',
          description: 'Staff records, attendance and deployment',
          permissions: JSON.stringify([
            'dashboard.view', 'projects.view', 'projects.edit', 'projects.create',
            'staff.view', 'staff.edit', 'staff.create', 'staff.delete',
            'attendance.view', 'attendance.edit', 'attendance.create',
            'payroll.view', 'clients.view', 'clients.edit', 'activity.view',
          ]),
        },
        {
          name: 'Viewer',
          description: 'Read-only access to dashboards and reports',
          permissions: JSON.stringify([
            'dashboard.view', 'projects.view', 'staff.view', 'attendance.view',
            'payroll.view', 'accounts.view', 'activity.view', 'clients.view',
          ]),
        },
      ],
    })
    const superAdmin = await db.role.findUnique({ where: { name: 'Super Admin' } })

    // ---------- Default company settings (editable later in Settings) ----------
    const settings: Record<string, string> = {
      companyName: 'Landmark Inter Gulf',
      address:
        'Al Suwedhi Business Centre, Office # 103, 1st Floor, P.O.Box 35712, Building 5526, 4th Street, Distt. Al Wahah, Jubail, Kingdom of Saudi Arabia',
      phone: '+966 13 847 2200',
      email: 'info@landmarkintergulf.com',
      currency: 'SAR',
      defaultPayType: 'bank_transfer',
      authorizedSignatory: '',
      signatoryTitle: 'Authorized Signatory',
      vatRate: '15',
    }
    await db.setting.createMany({
      data: Object.entries(settings).map(([key, value]) => ({ key, value })),
    })

    // ---------- The first administrator account ----------
    const admin = await db.user.create({
      data: {
        name,
        email,
        password: await hashPassword(password),
        roleId: superAdmin?.id ?? null,
      },
      select: { id: true, name: true, email: true },
    })

    await db.activityLog.create({
      data: {
        userId: admin.id,
        userName: admin.name,
        action: 'system',
        module: 'system',
        description: `System initialized — administrator account created (${admin.email})`,
      },
    })

    const sessionUser: SessionUser = {
      id: admin.id,
      name: admin.name,
      email: admin.email,
      avatar: null,
      role: superAdmin
        ? { id: superAdmin.id, name: superAdmin.name, permissions: ['*'] }
        : null,
    }
    await logActivity({
      user: sessionUser,
      action: 'created',
      module: 'user',
      description: `First administrator account created: ${admin.name}`,
    })

    return ok({ initialized: true, admin: { name: admin.name, email: admin.email } })
  } catch (err) {
    console.error('[api/bootstrap POST]', err)
    return serverError('Failed to create the administrator account')
  }
}
