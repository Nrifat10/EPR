// One-off idempotent seed for the saved-suppliers directory (Supplier P.O. module).
// Run: bun prisma/seed-suppliers.ts
// Creates 3 realistic Saudi manpower suppliers only when missing (never overwrites).
import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()

const DEMO_SUPPLIERS = [
  {
    name: 'Al-Rashid Manpower Services Co.',
    contactPerson: 'Mr. Khalid Al-Rashid',
    phone: '+966 55 482 7710',
    email: 'ops@alrashidmanpower.com',
    address: 'Prince Mohammed Bin Fahd Rd, Al Faisaliyah, Dammam 32241, Saudi Arabia',
    vatNumber: '310284657700003',
    crNumber: '2050 148 772',
    notes: 'Electricians, plumbers and general helpers. 48-hour mobilization.',
  },
  {
    name: 'Gulf Technical Support Contracting',
    contactPerson: 'Mr. Faisal Al-Otaibi',
    phone: '+966 50 913 6642',
    email: 'faisal@gulftechsupport.sa',
    address: 'King Saud Rd, Al Nahdah, Riyadh 34623, Saudi Arabia',
    vatNumber: '300715298400003',
    crNumber: '1010 662 391',
    notes: 'HVAC technicians, welders and certified riggers.',
  },
  {
    name: 'Eastern Province Labour Supply Est.',
    contactPerson: 'Mr. Ahmed Al-Qahtani',
    phone: '+966 56 220 8854',
    email: 'contact@eplabour.com',
    address: 'Corniche Rd, Al Khobar 34424, Eastern Province, Saudi Arabia',
    vatNumber: '309981247300003',
    crNumber: '2250 014 618',
    notes: 'Civil foremen, steel fixers and scaffolders. GOSI compliant.',
  },
]

async function main() {
  let created = 0
  for (const s of DEMO_SUPPLIERS) {
    const existing = await db.supplier.findUnique({ where: { name: s.name } })
    if (existing) continue
    await db.supplier.create({
      data: { ...s, status: 'active', createdByName: 'System Seed' },
    })
    created += 1
  }
  const total = await db.supplier.count()
  console.log(`✅ Suppliers directory: ${created} created, ${total} total.`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => db.$disconnect())
