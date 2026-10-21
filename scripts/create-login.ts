// One-off: create the OWNER's professional login credentials on the demo DB.
// - Owner/admin → admin@landmarkintergulf.com / Landmark@2025 (Super Admin)
// - Demo role users get strong, memorable passwords too (shown on login screen)
// Run: bun scripts/create-login.ts
import { PrismaClient } from '@prisma/client'
import { randomBytes, scrypt as _scrypt } from 'crypto'
import { promisify } from 'util'

const db = new PrismaClient()
const scrypt = promisify(_scrypt) as (p: string, s: string, k: number) => Promise<Buffer>

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex')
  const derived = await scrypt(password, salt, 64)
  return `${salt}:${derived.toString('hex')}`
}

const TARGETS: { email: string; newName?: string; newEmail?: string; password: string }[] = [
  // Owner account — professional company-domain login
  {
    email: 'admin@example.com',
    newEmail: 'admin@landmarkintergulf.com',
    newName: 'Landmark Admin',
    password: 'Landmark@2025',
  },
  // Demo role accounts — strong memorable passwords
  { email: 'accountant@example.com', password: 'Accountant@2025' },
  { email: 'hr@example.com', password: 'HrManager@2025' },
  { email: 'viewer@example.com', password: 'Viewer@2025' },
]

async function main() {
  for (const t of TARGETS) {
    const user = await db.user.findUnique({ where: { email: t.email } })
    if (!user) {
      console.log(`SKIP (not found): ${t.email}`)
      continue
    }
    if (t.newEmail) {
      const clash = await db.user.findUnique({ where: { email: t.newEmail } })
      if (clash) {
        console.log(`SKIP (target email exists): ${t.newEmail}`)
        continue
      }
    }
    await db.user.update({
      where: { id: user.id },
      data: {
        name: t.newName ?? user.name,
        email: t.newEmail ?? user.email,
        password: await hashPassword(t.password),
      },
    })
    console.log(`UPDATED: ${user.email} → ${t.newEmail ?? user.email} (${t.newName ?? user.name})`)
  }

  const users = await db.user.findMany({ include: { role: true }, orderBy: { createdAt: 'asc' } })
  console.log('\nActive logins:')
  for (const u of users) {
    console.log(`  ${u.email.padEnd(36)} role=${u.role?.name ?? '—'} active=${u.isActive}`)
  }
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => db.$disconnect())
