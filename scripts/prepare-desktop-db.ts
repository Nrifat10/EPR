// Prepare the SQLite DB copy that ships inside the Windows installer:
//   1. Copy db/custom.db → desktop/seed-db/custom.db
//   2. Ensure a working demo Super Admin: admin@example.com / password
//      (the live DB only has admin@landmarkintergulf.com, whose password
//      the installer user may not know — demo logins must work out of the box)
//
// Usage: bun scripts/prepare-desktop-db.ts
import { PrismaClient } from '@prisma/client'
import { randomBytes, scrypt as _scrypt } from 'crypto'
import { promisify } from 'util'
import { mkdirSync, copyFileSync } from 'fs'

const scrypt = promisify(_scrypt) as (p: string, s: string, k: number) => Promise<Buffer>

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex')
  const derived = await scrypt(password, salt, 64)
  return `${salt}:${derived.toString('hex')}`
}

const root = '/home/z/my-project'
const seedDir = `${root}/desktop/seed-db`
const seedDb = `${seedDir}/custom.db`

const db = new PrismaClient({
  datasources: { db: { url: `file:${seedDb}` } },
})

async function main() {
  mkdirSync(seedDir, { recursive: true })
  copyFileSync(`${root}/db/custom.db`, seedDb)
  console.log(`✓ copied live DB → ${seedDb}`)

  const superAdmin = await db.role.findFirst({ where: { name: 'Super Admin' } })
  if (!superAdmin) throw new Error('Super Admin role not found')

  const email = 'admin@example.com'
  const existing = await db.user.findUnique({ where: { email } })
  const password = await hashPassword('password')

  if (existing) {
    await db.user.update({
      where: { email },
      data: { password, roleId: superAdmin.id, isActive: true, name: existing.name || 'Admin' },
    })
    console.log(`✓ reset existing ${email} → Super Admin / password`)
  } else {
    await db.user.create({
      data: {
        email,
        name: 'Admin',
        password,
        roleId: superAdmin.id,
        isActive: true,
      },
    })
    console.log(`✓ created ${email} → Super Admin / password`)
  }

  const users = await db.user.findMany({
    select: { email: true, isActive: true, role: { select: { name: true } } },
    orderBy: { createdAt: 'asc' },
  })
  console.log('\nActive logins in packaged DB:')
  for (const u of users) {
    console.log(`  ${u.email.padEnd(34)} role=${u.role?.name ?? '—'} active=${u.isActive}`)
  }
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => db.$disconnect())
