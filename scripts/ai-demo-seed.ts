// Additive demo-workforce seeder for AI Assistant QA + demo use.
// Adds ONLY missing demo data (no deletes): staff categories, workers with
// Iqama expiry spread, projects on existing clients, deployments, October
// attendance, September 2026 payroll, advances, VAT bills, expense
// transactions and one older issued invoice (receivables aging demo).
// Idempotent: the Setting key "aiDemoSeeded" guards a second run.
import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()
const DAY = 86_400_000
const today = new Date()
const d = (offsetDays: number) => new Date(Date.UTC(2026, 9, 20) + offsetDays * DAY) // 2026-10-20 base

async function main() {
  const guard = await db.setting.findUnique({ where: { key: 'aiDemoSeeded' } })
  if (guard) {
    console.log('AI demo data already seeded — skipping.')
    return
  }

  // ── staff categories ──
  const catNames = ['Electrician', 'Plumber', 'Welder', 'General Labour', 'Foreman']
  const cats: Record<string, string> = {}
  for (const name of catNames) {
    const existing = await db.staffCategory.findFirst({ where: { name } })
    cats[name] =
      existing?.id ??
      (await db.staffCategory.create({ data: { name, description: `${name} trade` } })).id
  }

  // ── projects on the existing demo clients ──
  const clients = await db.client.findMany()
  const byName = (frag: string) => clients.find((c) => c.name.includes(frag))
  const alRushaid = byName('Al Rushaid')
  const gulfSteel = byName('Gulf Steel')
  const jubailTech = byName('Jubail Technical')
  const mkProject = async (name: string, location: string, clientId: string | undefined, rate: number) =>
    (await db.project.findFirst({ where: { name } })) ??
    (await db.project.create({
      data: { name, managerName: 'Eng. Saud Al-Otaibi', location, clientId: clientId ?? null, clientRatePerHour: rate, status: 'active' },
    }))
  const pRushaid = await mkProject('Al Rushaid Tower Construction', 'Dammam - Al Faisaliyah', alRushaid?.id, 28)
  const pSteel = await mkProject('Gulf Steel Plant Maintenance', 'Jubail Industrial City 2', gulfSteel?.id, 26)
  const pTech = await mkProject('Jubail Tech Warehouse Fitout', 'Jubail - Madayef', jubailTech?.id, 24)

  // ── workers: name, trade, iqama expiry offset (days from 2026-10-20), rate ──
  const workers: { name: string; trade: string; expOffset: number; rate: number; project: string; nat: string }[] = [
    // Iqama expiring within 30 days (Nov 2026)
    { name: 'Mohammad Rafiq', trade: 'Electrician', expOffset: 12, rate: 22, project: 'rushaid', nat: 'BD' },
    { name: 'Abdul Karim', trade: 'Welder', expOffset: 21, rate: 24, project: 'steel', nat: 'PK' },
    { name: 'Suresh Kumar', trade: 'Plumber', expOffset: 28, rate: 20, project: 'rushaid', nat: 'IN' },
    // Already expired (Oct 2026)
    { name: 'Mahmoud Hassan', trade: 'General Labour', expOffset: -8, rate: 16, project: 'tech', nat: 'EG' },
    // 31-60 days (Dec 2026)
    { name: 'Jahangir Alam', trade: 'Electrician', expOffset: 44, rate: 22, project: 'steel', nat: 'BD' },
    { name: 'Ravi Prasad', trade: 'Foreman', expOffset: 55, rate: 30, project: 'rushaid', nat: 'IN' },
    // Far future 2027+
    { name: 'Kamal Hossain', trade: 'General Labour', expOffset: 190, rate: 16, project: 'rushaid', nat: 'BD' },
    { name: 'Imran Sheikh', trade: 'Welder', expOffset: 240, rate: 24, project: 'steel', nat: 'PK' },
    { name: 'Dilip Das', trade: 'Electrician', expOffset: 300, rate: 22, project: 'tech', nat: 'BD' },
    { name: 'Ahmed Sayed', trade: 'Plumber', expOffset: 330, rate: 20, project: 'steel', nat: 'EG' },
    { name: 'Babul Akter', trade: 'General Labour', expOffset: 365, rate: 16, project: 'tech', nat: 'BD' },
    { name: 'Nasir Ali', trade: 'Foreman', expOffset: 410, rate: 30, project: 'steel', nat: 'PK' },
    { name: 'Tarun Ghosh', trade: 'Electrician', expOffset: 450, rate: 22, project: 'rushaid', nat: 'IN' },
    { name: 'Faisal Rehman', trade: 'General Labour', expOffset: 500, rate: 16, project: 'tech', nat: 'PK' },
  ]
  const projectMap: Record<string, string> = { rushaid: pRushaid.id, steel: pSteel.id, tech: pTech.id }

  let seed = 42
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648
    return seed / 2147483648
  }

  const staffRows: { id: string; name: string; rate: number; projectId: string }[] = []
  let n = 0
  for (const w of workers) {
    n += 1
    const iqama = `2${String(45000000 + n * 137711).padStart(9, '0')}`
    const staff = await db.staff.create({
      data: {
        fullName: w.name,
        phone: `+9665${String(50000000 + Math.floor(rnd() * 9999999)).slice(0, 8)}`,
        position: w.trade,
        staffCategoryId: cats[w.trade],
        iqamaId: iqama,
        iqamaExpiry: d(w.expOffset),
        passportExpiry: d(w.expOffset + 400),
        joiningDate: d(-500 - Math.floor(rnd() * 400)),
        ratePerHour: w.rate,
        overtimeRate: Math.round(w.rate * 1.5 * 100) / 100,
        monthlySalary: w.rate * 240,
        residentialAddress: 'Jubail Workers Housing, KSA',
        status: 'active',
      },
    })
    const projectId = projectMap[w.project]
    await db.projectStaff.create({ data: { projectId, staffId: staff.id } })
    staffRows.push({ id: staff.id, name: w.name, rate: w.rate, projectId })
  }

  // ── attendance: October 2026, ~14 entries each (9-10h) ──
  let attCount = 0
  for (const s of staffRows) {
    for (let day = 1; day <= 19; day += 1) {
      if (day % 7 === 5 || day % 7 === 6) continue // Fri/Sat off pattern
      if (rnd() < 0.12) continue // occasional absence
      const checkIn = new Date(Date.UTC(2026, 9, day, 6, 30))
      const hours = 9 + Math.round(rnd()) // 9-10h
      const checkOut = new Date(checkIn.getTime() + hours * 3_600_000)
      await db.attendance.create({
        data: {
          staffId: s.id,
          projectId: s.projectId,
          checkIn,
          checkOut,
          durationMinutes: hours * 60,
        },
      })
      attCount += 1
    }
  }

  // ── September 2026 payroll (last month) ──
  let payrollCount = 0
  const advanceTargets = new Set([staffRows[0].id, staffRows[6].id])
  for (const s of staffRows) {
    const totalHours = 208 + Math.floor(rnd() * 26) // 208-233
    const overtimeHours = Math.floor(rnd() * 12)
    const gross = Math.round((totalHours * s.rate + overtimeHours * s.rate * 1.5) * 100) / 100
    const advance = advanceTargets.has(s.id) ? 300 : 0
    const otherDeduction = Math.round(rnd() * 60 * 100) / 100
    const deductions = Math.round((advance + otherDeduction) * 100) / 100
    await db.payroll.create({
      data: {
        staffId: s.id,
        projectId: s.projectId,
        month: 9,
        year: 2026,
        totalHours,
        hourlyRateSnapshot: s.rate,
        overtimeHours,
        overtimeRateSnapshot: Math.round(s.rate * 1.5 * 100) / 100,
        otherEarnings: 0,
        advance,
        absentPenalty: 0,
        otherDeductionValue: otherDeduction,
        otherDeductionType: 'fixed',
        grossPay: gross,
        totalDeductions: deductions,
        netPay: Math.round((gross - deductions) * 100) / 100,
        status: payrollCount % 4 === 3 ? 'pending' : 'paid',
        payDate: payrollCount % 4 === 3 ? null : d(-25),
        payType: 'bank_transfer',
      },
    })
    payrollCount += 1
  }

  // ── worker advances (October 2026) ──
  await db.workerAdvance.create({
    data: {
      staffId: staffRows[0].id,
      amount: 900,
      givenDate: d(-12),
      paymentMethod: 'cash',
      reference: 'Family emergency — voucher V-1042',
      deductionMonth: 10,
      deductionYear: 2026,
      installments: 3,
      deductedAmount: 300,
      status: 'partially_deducted',
    },
  })
  await db.workerAdvance.create({
    data: {
      staffId: staffRows[6].id,
      amount: 500,
      givenDate: d(-5),
      paymentMethod: 'bank_transfer',
      reference: 'Advance against salary',
      deductionMonth: 10,
      deductionYear: 2026,
      installments: 2,
      deductedAmount: 0,
      status: 'pending',
    },
  })

  // ── VAT expense bills (Q4 2026 input VAT) ──
  await db.vatExpenseBill.create({
    data: {
      billDate: d(-14),
      billNumber: 'SINV-2026-0881',
      supplierName: 'Jubail Industrial Supplies Co.',
      supplierVatNumber: '310283746500003',
      description: 'Safety helmets, gloves and boots — site PPE restock',
      amountWithVat: 5750,
      amountWithoutVat: 5000,
      vatAmount: 750,
      vatRateSnapshot: 0.15,
    },
  })
  await db.vatExpenseBill.create({
    data: {
      billDate: d(-3),
      billNumber: 'SINV-2026-0904',
      supplierName: 'Dammam Tools & Equipment Est.',
      supplierVatNumber: '310559122800003',
      description: 'Power tools maintenance + welding rods',
      amountWithVat: 11500,
      amountWithoutVat: 10000,
      vatAmount: 1500,
      vatRateSnapshot: 0.15,
    },
  })

  // ── expense transactions (October 2026) ──
  const mkCat = async (name: string, type: string) =>
    (await db.transactionCategory.findFirst({ where: { name } })) ??
    (await db.transactionCategory.create({ data: { name, type } }))
  const catPpe = await mkCat('PPE & Safety', 'expense')
  const catFuel = await mkCat('Fuel & Transport', 'expense')
  const catAccom = await mkCat('Worker Accommodation', 'expense')
  await db.transaction.create({
    data: { type: 'expense', title: 'Site PPE restock', amount: 5000, transactionCategoryId: catPpe.id, projectId: pRushaid.id, transactionDate: d(-14), description: 'Helmets, gloves, boots' },
  })
  await db.transaction.create({
    data: { type: 'expense', title: 'October diesel — site vehicles', amount: 2850, transactionCategoryId: catFuel.id, projectId: pSteel.id, transactionDate: d(-9) },
  })
  await db.transaction.create({
    data: { type: 'expense', title: 'Workers housing rent — October', amount: 18000, transactionCategoryId: catAccom.id, transactionDate: d(-2) },
  })

  // ── one older ISSUED invoice so receivables aging shows a 60+ day entry ──
  const existing = await db.eInvoice.findUnique({ where: { invoiceNumber: 'INV-2026-00006' } })
  if (!existing) {
    const inv = await db.eInvoice.create({
      data: {
        invoiceNumber: 'INV-2026-00006',
        docType: 'invoice',
        clientId: gulfSteel?.id ?? null,
        clientNameEn: 'Gulf Steel Industries Co.',
        issueDate: d(-97), // Jul 15, 2026
        supplyDate: d(-97),
        dueDate: d(-67), // Aug 14, 2026 → 67 days overdue on Oct 20
        status: 'issued',
        subtotal: 38000,
        taxableAmount: 38000,
        vatAmount: 5700,
        totalDue: 43700,
        paidAmount: 0,
        zatcaPhase: 1,
        paymentTermsEn: 'Net 30 days',
      },
    })
    await db.eInvoiceItem.create({
      data: {
        eInvoiceId: inv.id,
        sr: 1,
        descriptionEn: 'Manpower supply — maintenance crew (June-Jul 2026)',
        unitEn: 'month',
        quantity: 1,
        unitPrice: 38000,
        vatPercent: 15,
        taxableAmount: 38000,
        vatAmount: 5700,
        lineTotal: 43700,
      },
    })
  }

  await db.setting.create({
    data: { key: 'aiDemoSeeded', value: new Date().toISOString() },
  })
  console.log(
    `AI demo data seeded: ${staffRows.length} workers, 3 projects, ${attCount} attendance entries, ${payrollCount} Sept-2026 payrolls, 2 advances, 2 VAT bills, 3 expenses, 1 aging invoice.`
  )
  void today
}

main()
  .catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(() => db.$disconnect())
