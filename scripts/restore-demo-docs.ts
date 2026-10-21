// One-off restore: recreate the BUSINESS DOCUMENT demo data that was wiped by
// the base `bun run db:seed` (which only restores the core dataset).
// Restores: project client rates, quotations, invoices, supplier POs,
// agreements, name-list entries, VAT expense bills, worker advances
// (with linked accounting transactions + payroll deduction rows).
//
// IDEMPOTENT: wipes only the doc/advance tables it owns, reverses previous
// payroll advance effects, then recreates. Core data (staff/projects/payrolls/
// clients/transactions) is preserved.
//
// Run: bun scripts/restore-demo-docs.ts
import { PrismaClient, Payroll } from '@prisma/client'

const db = new PrismaClient()

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100
const VAT = 0.15
const d = (y: number, m: number, day: number) => new Date(Date.UTC(y, m - 1, day, 9, 0, 0))

async function main() {
  console.log('🔁 Restoring business-document demo data…')

  const clients = await db.client.findMany()
  const byName = (frag: string) => clients.find((c) => c.name.includes(frag))
  const alWaha = byName('Al Waha')!
  const gulfCrescent = byName('Gulf Crescent')!
  const eastern = byName('Eastern Province')!
  const redSea = byName('Red Sea')!
  const tabuk = byName('Tabuk')!

  // ─────────────────────────────────────────────────────────────────────────
  // 0) Project client rates (manpower billing price billed to the client)
  // ─────────────────────────────────────────────────────────────────────────
  const projects = await db.project.findMany()
  const rates: Record<string, number> = {
    'Aramco': 65, 'SABIC': 65, 'Riyadh Metro': 60,
    'Jazan': 60, 'NEOM': 60, 'Yanbu': 58,
  }
  for (const p of projects) {
    const match = Object.keys(rates).find((k) => p.name.includes(k))
    if (match) await db.project.update({ where: { id: p.id }, data: { clientRatePerHour: rates[match] } })
  }
  console.log(`  ✓ project client rates (${projects.length} projects scanned)`)

  // ─────────────────────────────────────────────────────────────────────────
  // 1) Reverse + wipe previous advance state (payroll columns, deduction rows,
  //    linked transactions) so re-runs never double-apply.
  // ─────────────────────────────────────────────────────────────────────────
  const oldDeductions = await db.payrollAdvanceDeduction.findMany()
  const perPayroll = new Map<string, number>()
  for (const row of oldDeductions) perPayroll.set(row.payrollId, round2((perPayroll.get(row.payrollId) ?? 0) + row.amount))
  for (const [payrollId, amt] of perPayroll) {
    const p = await db.payroll.findUnique({ where: { id: payrollId } })
    if (!p) continue
    await db.payroll.update({
      where: { id: payrollId },
      data: {
        advance: round2(Math.max(0, p.advance - amt)),
        totalDeductions: round2(Math.max(0, p.totalDeductions - amt)),
        netPay: round2(p.netPay + amt),
      },
    })
  }
  if (oldDeductions.length) console.log(`  ✓ reversed ${oldDeductions.length} payroll advance deduction rows`)
  await db.payrollAdvanceDeduction.deleteMany()

  const advCats = await db.transactionCategory.findMany({
    where: { name: { in: ['Advance to Workers', 'Advance Recovery'] } },
  })
  const advExpCat = advCats.find((c) => c.name === 'Advance to Workers')
  const advRecCat = advCats.find((c) => c.name === 'Advance Recovery')
  if (advExpCat) await db.transaction.deleteMany({ where: { transactionCategoryId: advExpCat.id } })
  if (advRecCat) await db.transaction.deleteMany({ where: { transactionCategoryId: advRecCat.id } })
  await db.workerAdvance.deleteMany()

  // ─────────────────────────────────────────────────────────────────────────
  // 2) Wipe + recreate business documents
  // ─────────────────────────────────────────────────────────────────────────
  await db.agreementClause.deleteMany()
  await db.agreementInstallment.deleteMany()
  await db.agreementItem.deleteMany()
  await db.agreement.deleteMany()
  await db.invoiceItem.deleteMany()
  await db.invoice.deleteMany()
  await db.quotationItem.deleteMany()
  await db.quotation.deleteMany()
  await db.supplierPoItem.deleteMany()
  await db.supplierPo.deleteMany()
  await db.nameListEntry.deleteMany()
  await db.vatExpenseBill.deleteMany()

  const admin = await db.user.findFirst({ where: { email: 'admin@landmarkintergulf.com' } })

  type ItemIn = { description: string; unit?: string; quantity: number; unitPrice: number }
  const itemOut = (it: ItemIn, sr: number) => ({
    sr,
    description: it.description,
    unit: it.unit ?? null,
    quantity: it.quantity,
    unitPrice: it.unitPrice,
    lineTotal: round2(it.quantity * it.unitPrice),
  })
  const totalsOf = (items: ItemIn[], discount = 0) => {
    const subtotal = round2(items.reduce((s, it) => s + round2(it.quantity * it.unitPrice), 0))
    const vatAmount = round2((subtotal - discount) * VAT)
    return { subtotal, vatAmount, total: round2(subtotal - discount + vatAmount) }
  }

  // ── QUOTATIONS ────────────────────────────────────────────────────────────
  const quotations: {
    quoteNumber: string; clientId: string | null; clientName: string; subject: string
    issueDate: Date; validityDate: Date; status: string; discount?: number
    notes?: string; terms?: string; items: ItemIn[]
  }[] = [
    {
      quoteNumber: 'QTN-2026-0001', clientId: eastern.id, clientName: eastern.name,
      subject: 'Supply of skilled technicians — Aramco Rig Upgrade Phase 3',
      issueDate: d(2026, 8, 6), validityDate: d(2026, 9, 6), status: 'accepted',
      notes: 'Rates quoted per worker per month, inclusive of site transportation.',
      terms: 'Payment within 30 days of invoice. Validity 30 days from issue.',
      items: [
        { description: 'Mechanical Technician — monthly supply', unit: 'worker/month', quantity: 4, unitPrice: 3400 },
        { description: 'Electrical Technician — monthly supply', unit: 'worker/month', quantity: 2, unitPrice: 3600 },
        { description: 'Rig Helper — monthly supply', unit: 'worker/month', quantity: 6, unitPrice: 1900 },
      ],
    },
    {
      quoteNumber: 'QTN-2026-0002', clientId: alWaha.id, clientName: alWaha.name,
      subject: 'Manpower supply — SABIC Gas Plant Piping Works (15 workers)',
      issueDate: d(2026, 9, 1), validityDate: d(2026, 9, 30), status: 'accepted',
      notes: 'Pipe fitters and welders with 6G certification as discussed.',
      terms: 'Payment within 30 days. Rates fixed for the contract duration.',
      items: [
        { description: 'Pipe Fitter (6G certified) — monthly supply', unit: 'worker/month', quantity: 8, unitPrice: 3200 },
        { description: 'Welder (TIG/MIG) — monthly supply', unit: 'worker/month', quantity: 5, unitPrice: 3500 },
        { description: 'Grinder / Fitter Helper — monthly supply', unit: 'worker/month', quantity: 2, unitPrice: 1800 },
      ],
    },
    {
      quoteNumber: 'QTN-2026-0003', clientId: gulfCrescent.id, clientName: gulfCrescent.name,
      subject: 'General workforce supply — Riyadh Metro Line 4 Civil Package',
      issueDate: d(2026, 10, 5), validityDate: d(2026, 11, 4), status: 'sent',
      notes: 'Mobilization within 14 days of acceptance.',
      items: [
        { description: 'Civil Foreman — monthly supply', unit: 'worker/month', quantity: 2, unitPrice: 4800 },
        { description: 'Steel Fixer — monthly supply', unit: 'worker/month', quantity: 8, unitPrice: 2400 },
        { description: 'General Helper — monthly supply', unit: 'worker/month', quantity: 10, unitPrice: 1700 },
      ],
    },
    {
      quoteNumber: 'QTN-2026-0004', clientId: redSea.id, clientName: redSea.name,
      subject: 'Certified welders — Jazan Refinery Coating Project',
      issueDate: d(2026, 9, 14), validityDate: d(2026, 10, 14), status: 'rejected',
      notes: 'Quotation declined — client selected a local contractor at lower rates.',
      items: [
        { description: 'Welder (Coating/Pipeline) — monthly supply', unit: 'worker/month', quantity: 6, unitPrice: 3300 },
        { description: 'Blaster / Painter — monthly supply', unit: 'worker/month', quantity: 4, unitPrice: 2100 },
      ],
    },
    {
      quoteNumber: 'QTN-2026-0005', clientId: tabuk.id, clientName: tabuk.name,
      subject: 'Helpers and drivers — NEOM Substation Construction',
      issueDate: d(2026, 10, 18), validityDate: d(2026, 11, 17), status: 'draft',
      items: [
        { description: 'Construction Helper — monthly supply', unit: 'worker/month', quantity: 10, unitPrice: 1750 },
        { description: 'Heavy Driver — monthly supply', unit: 'worker/month', quantity: 2, unitPrice: 2600 },
        { description: 'Site Housekeeping Staff — monthly supply', unit: 'worker/month', quantity: 3, unitPrice: 1500 },
      ],
    },
  ]
  for (const q of quotations) {
    const { subtotal, vatAmount, total } = totalsOf(q.items, q.discount ?? 0)
    await db.quotation.create({
      data: {
        quoteNumber: q.quoteNumber, clientId: q.clientId, clientName: q.clientName,
        subject: q.subject, issueDate: q.issueDate, validityDate: q.validityDate,
        status: q.status, subtotal, discount: q.discount ?? 0, vatRate: VAT,
        vatAmount, total, notes: q.notes ?? null, terms: q.terms ?? null,
        createdByName: 'Landmark Admin',
        items: { create: q.items.map((it, i) => itemOut(it, i + 1)) },
      },
    })
  }
  console.log(`  ✓ ${quotations.length} quotations with items`)

  // ── INVOICES ──────────────────────────────────────────────────────────────
  const invoices: {
    invoiceNumber: string; clientId: string; clientName: string; subject: string
    issueDate: Date; dueDate: Date; status: string; paidAmount?: number
    notes?: string; items: ItemIn[]
  }[] = [
    {
      invoiceNumber: 'INV-2026-0001', clientId: eastern.id, clientName: eastern.name,
      subject: 'Manpower supply — August 2026 (Aramco Rig Upgrade)',
      issueDate: d(2026, 9, 1), dueDate: d(2026, 10, 1), status: 'paid',
      notes: 'Payment received via bank transfer — RB-88451.',
      items: [
        { description: 'Mechanical Technician — 4 workers × August', unit: 'worker/month', quantity: 4, unitPrice: 3400 },
        { description: 'Electrical Technician — 2 workers × August', unit: 'worker/month', quantity: 2, unitPrice: 3600 },
        { description: 'Rig Helper — 6 workers × August', unit: 'worker/month', quantity: 6, unitPrice: 1900 },
      ],
    },
    {
      invoiceNumber: 'INV-2026-0002', clientId: alWaha.id, clientName: alWaha.name,
      subject: 'Manpower supply — September 2026 (SABIC Gas Plant Piping)',
      issueDate: d(2026, 10, 2), dueDate: d(2026, 11, 1), status: 'issued',
      notes: 'Payable within 30 days as per agreement AGR-2026-0001.',
      items: [
        { description: 'Pipe Fitter (6G) — 8 workers × September', unit: 'worker/month', quantity: 8, unitPrice: 3200 },
        { description: 'Welder (TIG/MIG) — 5 workers × September', unit: 'worker/month', quantity: 5, unitPrice: 3500 },
        { description: 'Grinder / Fitter Helper — 2 workers × September', unit: 'worker/month', quantity: 2, unitPrice: 1800 },
      ],
    },
    {
      invoiceNumber: 'INV-2026-0003', clientId: gulfCrescent.id, clientName: gulfCrescent.name,
      subject: 'Civil workforce supply — September 2026 (Metro Line 4)',
      issueDate: d(2026, 10, 3), dueDate: d(2026, 11, 2), status: 'issued',
      items: [
        { description: 'Civil Foreman — 2 workers × September', unit: 'worker/month', quantity: 2, unitPrice: 4800 },
        { description: 'Steel Fixer — 8 workers × September', unit: 'worker/month', quantity: 8, unitPrice: 2400 },
        { description: 'General Helper — 10 workers × September', unit: 'worker/month', quantity: 10, unitPrice: 1700 },
      ],
    },
    {
      invoiceNumber: 'INV-2026-0004', clientId: redSea.id, clientName: redSea.name,
      subject: 'Manpower supply — September 2026 (Jazan Refinery)',
      issueDate: d(2026, 9, 20), dueDate: d(2026, 10, 20), status: 'paid',
      notes: 'Received via cheque #447120 — cleared 12 Oct 2026.',
      items: [
        { description: 'Coating Workers — 5 workers × September', unit: 'worker/month', quantity: 5, unitPrice: 2200 },
      ],
    },
    {
      invoiceNumber: 'INV-2026-0005', clientId: tabuk.id, clientName: tabuk.name,
      subject: 'Preliminary mobilization — NEOM Substation (draft)',
      issueDate: d(2026, 10, 19), dueDate: d(2026, 11, 18), status: 'draft',
      items: [
        { description: 'Construction Helpers — 10 workers × October', unit: 'worker/month', quantity: 10, unitPrice: 1750 },
      ],
    },
  ]
  for (const inv of invoices) {
    const { subtotal, vatAmount, total } = totalsOf(inv.items)
    await db.invoice.create({
      data: {
        invoiceNumber: inv.invoiceNumber, clientId: inv.clientId, clientName: inv.clientName,
        subject: inv.subject, issueDate: inv.issueDate, dueDate: inv.dueDate,
        status: inv.status, subtotal, vatRate: VAT, vatAmount, total,
        paidAmount: inv.status === 'paid' ? total : (inv.paidAmount ?? 0),
        notes: inv.notes ?? null, createdByName: 'Landmark Admin',
        items: { create: inv.items.map((it, i) => itemOut(it, i + 1)) },
      },
    })
  }
  console.log(`  ✓ ${invoices.length} invoices with items`)

  // ── SUPPLIER POs ──────────────────────────────────────────────────────────
  const pos: {
    poNumber: string; supplierName: string; supplierPhone: string; attention: string
    issueDate: Date; expectedDate: Date; status: string; notes?: string; items: ItemIn[]
  }[] = [
    {
      poNumber: 'PO-2026-0001', supplierName: 'Al Khobar Steel Trading Est.',
      supplierPhone: '+966 13 822 4400', attention: 'Mr. Khalid Al-Harbi',
      issueDate: d(2026, 9, 8), expectedDate: d(2026, 9, 22), status: 'received',
      notes: 'Delivered to SABIC Gas Plant site store. GRN #118 filed.',
      items: [
        { description: 'MS Pipe 4" Sch 40 — seamless', unit: 'meter', quantity: 60, unitPrice: 145 },
        { description: 'Elbow fitting 4" 90° butt-weld', unit: 'pcs', quantity: 20, unitPrice: 85 },
        { description: 'Welding electrodes E7018 — 5kg box', unit: 'box', quantity: 10, unitPrice: 320 },
      ],
    },
    {
      poNumber: 'PO-2026-0002', supplierName: 'Jubail Safety Equipment Co.',
      supplierPhone: '+966 13 895 1177', attention: 'Ms. Reem Al-Qahtani',
      issueDate: d(2026, 9, 26), expectedDate: d(2026, 10, 10), status: 'ordered',
      notes: 'PPE for new NEOM mobilization batch.',
      items: [
        { description: 'Safety helmet (white) — ANSI Z89.1', unit: 'pcs', quantity: 40, unitPrice: 35 },
        { description: 'High-visibility reflective vest', unit: 'pcs', quantity: 40, unitPrice: 45 },
        { description: 'Safety shoes (steel toe)', unit: 'pair', quantity: 40, unitPrice: 120 },
        { description: 'Full-body safety harness with lanyard', unit: 'pcs', quantity: 10, unitPrice: 380 },
      ],
    },
    {
      poNumber: 'PO-2026-0003', supplierName: 'Dammam Industrial Supplies',
      supplierPhone: '+966 13 833 5620', attention: 'Mr. Saleh Al-Dossary',
      issueDate: d(2026, 10, 12), expectedDate: d(2026, 10, 26), status: 'ordered',
      items: [
        { description: 'Angle grinder 5" — heavy duty', unit: 'pcs', quantity: 6, unitPrice: 380 },
        { description: 'Extension power cord 20m — 3-core', unit: 'pcs', quantity: 6, unitPrice: 120 },
        { description: 'Portable work lights — LED twin head', unit: 'pcs', quantity: 4, unitPrice: 260 },
      ],
    },
    {
      poNumber: 'PO-2026-0004', supplierName: 'Riyadh Workwear Ltd.',
      supplierPhone: '+966 11 464 7788', attention: 'Mr. Tariq Al-Osaimi',
      issueDate: d(2026, 9, 3), expectedDate: d(2026, 9, 17), status: 'cancelled',
      notes: 'Cancelled — Metro Line 4 coveralls sourced from existing stock.',
      items: [
        { description: 'Coverall — navy blue, reflective tape', unit: 'pcs', quantity: 30, unitPrice: 95 },
      ],
    },
  ]
  for (const p of pos) {
    const { subtotal, vatAmount, total } = totalsOf(p.items)
    await db.supplierPo.create({
      data: {
        poNumber: p.poNumber, supplierName: p.supplierName, supplierPhone: p.supplierPhone,
        attention: p.attention, issueDate: p.issueDate, expectedDate: p.expectedDate,
        status: p.status, subtotal, vatRate: VAT, vatAmount, total,
        notes: p.notes ?? null, createdByName: 'Landmark Admin',
        items: { create: p.items.map((it, i) => itemOut(it, i + 1)) },
      },
    })
  }
  console.log(`  ✓ ${pos.length} supplier POs with items`)

  // ── AGREEMENTS ────────────────────────────────────────────────────────────
  // 1) Signed labor-supply agreement — detailed layout (items + installments + clauses)
  {
    const items: ItemIn[] = [
      { description: 'Pipe Fitter (6G certified) — annual supply contract', unit: 'worker/month', quantity: 8, unitPrice: 3200 },
      { description: 'Welder (TIG/MIG) — annual supply contract', unit: 'worker/month', quantity: 5, unitPrice: 3500 },
      { description: 'Grinder / Fitter Helper — annual supply contract', unit: 'worker/month', quantity: 2, unitPrice: 1800 },
    ]
    const value = round2(items.reduce((s, it) => s + round2(it.quantity * it.unitPrice), 0) * 12)
    await db.agreement.create({
      data: {
        refNumber: 'AGR-2026-0001', title: 'Annual Labor Supply Agreement — SABIC Gas Plant Piping Works',
        partyA: 'Landmark Inter Gulf LLC', clientId: alWaha.id, clientName: alWaha.name,
        type: 'labor_supply', layoutStyle: 'detailed',
        startDate: d(2026, 9, 1), endDate: d(2027, 8, 31), status: 'signed',
        value, currency: 'SAR',
        notes: 'Rates fixed for 12 months. Renewal subject to review.',
        createdByName: 'Landmark Admin',
        items: { create: items.map((it, i) => itemOut(it, i + 1)) },
        installments: {
          create: [
            { sr: 1, label: 'Monthly manpower billing — September 2026', dueDate: d(2026, 10, 5), amount: round2(value / 12), paid: true },
            { sr: 2, label: 'Monthly manpower billing — October 2026', dueDate: d(2026, 11, 5), amount: round2(value / 12), paid: false },
            { sr: 3, label: 'Monthly manpower billing — November 2026', dueDate: d(2026, 12, 5), amount: round2(value / 12), paid: false },
          ],
        },
        clauses: {
          create: [
            { sr: 1, title: 'Scope of Services', body: 'The First Party shall supply to the Second Party skilled manpower (pipe fitters, welders and helpers) as per the manning schedule annexed to this Agreement, for execution of piping works at the SABIC Gas Plant, Jubail.' },
            { sr: 2, title: 'Contract Duration', body: 'This Agreement shall be valid for twelve (12) Gregorian months commencing 01 September 2026 and ending 31 August 2027, renewable by mutual written consent.' },
            { sr: 3, title: 'Rates and Payment', body: 'The monthly rates stated in the Schedule of Rates are fixed for the entire duration. Invoices shall be submitted on the 1st of each month and paid within thirty (30) days of receipt.' },
            { sr: 4, title: 'Obligations of the First Party', body: 'The First Party shall ensure all supplied workers hold valid iqama and medical insurance, provide site transportation and accommodation, and comply with all Saudi labor regulations and the Second Party\'s HSE policy.' },
            { sr: 5, title: 'Obligations of the Second Party', body: 'The Second Party shall provide a safe working environment, necessary work permits, and notify the First Party fourteen (14) days in advance of any change in required manpower.' },
            { sr: 6, title: 'Termination', body: 'Either party may terminate this Agreement by giving sixty (60) days written notice. Amounts for work performed up to the termination date shall remain payable.' },
          ],
        },
      },
    })
  }
  // 2) Final service agreement — simple layout (price-as-per-PO)
  {
    const value = 268000
    await db.agreement.create({
      data: {
        refNumber: 'AGR-2026-0002', title: 'Workforce Supply Services — Riyadh Metro Line 4 Civil Package',
        partyA: 'Landmark Inter Gulf LLC', clientId: gulfCrescent.id, clientName: gulfCrescent.name,
        type: 'service', layoutStyle: 'simple',
        startDate: d(2026, 10, 1), endDate: d(2027, 3, 31), status: 'final',
        value, currency: 'SAR',
        notes: 'Price as per Client Purchase Order No. GCC-METRO-PO-4471.',
        createdByName: 'Landmark Admin',
        installments: {
          create: [
            { sr: 1, label: 'Mobilization advance (20%)', dueDate: d(2026, 10, 15), amount: round2(value * 0.2), paid: true },
            { sr: 2, label: 'Monthly progress payment — October', dueDate: d(2026, 11, 10), amount: round2(value * 0.16), paid: false },
            { sr: 3, label: 'Monthly progress payment — November', dueDate: d(2026, 12, 10), amount: round2(value * 0.16), paid: false },
            { sr: 4, label: 'Monthly progress payment — December', dueDate: d(2027, 1, 10), amount: round2(value * 0.16), paid: false },
            { sr: 5, label: 'Final payment on demobilization (32%)', dueDate: d(2027, 4, 10), amount: round2(value * 0.32), paid: false },
          ],
        },
      },
    })
  }
  // 3) Draft subcontract — detailed layout
  {
    const items: ItemIn[] = [
      { description: 'Scaffolding erection & dismantling crew', unit: 'crew/month', quantity: 2, unitPrice: 18500 },
      { description: 'Certified rigging crew with supervisor', unit: 'crew/month', quantity: 1, unitPrice: 22000 },
    ]
    const value = round2(items.reduce((s, it) => s + round2(it.quantity * it.unitPrice), 0) * 6)
    await db.agreement.create({
      data: {
        refNumber: 'AGR-2026-0003', title: 'Subcontract — Scaffolding & Rigging Services, Aramco Rig Upgrade',
        partyA: 'Landmark Inter Gulf LLC', clientId: eastern.id, clientName: eastern.name,
        type: 'subcontract', layoutStyle: 'detailed',
        startDate: d(2026, 11, 1), endDate: d(2027, 4, 30), status: 'draft',
        value, currency: 'SAR',
        notes: 'Draft pending client review of crew certifications.',
        createdByName: 'Landmark Admin',
        items: { create: items.map((it, i) => itemOut(it, i + 1)) },
        installments: {
          create: [
            { sr: 1, label: 'Advance payment (25%)', dueDate: d(2026, 11, 10), amount: round2(value * 0.25), paid: false },
            { sr: 2, label: 'On completion (75%)', dueDate: d(2027, 5, 10), amount: round2(value * 0.75), paid: false },
          ],
        },
        clauses: {
          create: [
            { sr: 1, title: 'Scope', body: 'Provision of scaffolding erection, modification and dismantling crews together with certified riggers for the duration of the Rig Upgrade Phase 3 shutdown.' },
            { sr: 2, title: 'Compliance', body: 'All crew members shall hold valid Aramco scaffolding and rigging certifications. Non-compliant workers shall be replaced at no cost within 48 hours.' },
          ],
        },
      },
    })
  }
  console.log('  ✓ 3 agreements (items + installments + clauses)')

  // ── NAME LIST ─────────────────────────────────────────────────────────────
  const nameList = [
    { name: 'Al Khobar Steel Trading Est.', type: 'supplier', contactPerson: 'Khalid Al-Harbi', phone: '+966 13 822 4400', email: 'sales@alkhobarsteel.com', crNumber: '2050144789', vatNumber: '310257896300003', address: 'Industrial Area 2, King Abdulaziz Road', city: 'Al Khobar' },
    { name: 'Jubail Safety Equipment Co.', type: 'supplier', contactPerson: 'Reem Al-Qahtani', phone: '+966 13 895 1177', email: 'orders@jubailsafety.sa', crNumber: '2050223156', vatNumber: '310291147800003', address: 'Jubail Industrial City 1', city: 'Jubail' },
    { name: 'Dammam Industrial Supplies', type: 'supplier', contactPerson: 'Saleh Al-Dossary', phone: '+966 13 833 5620', email: 'info@dammanind.com', crNumber: '2050098734', address: '2nd Industrial City, Dammam', city: 'Dammam' },
    { name: 'Riyadh Workwear Ltd.', type: 'supplier', contactPerson: 'Tariq Al-Osaimi', phone: '+966 11 464 7788', email: 'tariq@riyadhworkwear.sa', crNumber: '1010388221', address: 'Exit 18, Riyadh', city: 'Riyadh' },
    { name: 'Eastern Welding Services', type: 'subcontractor', contactPerson: 'Hassan Al-Mutairi', phone: '+966 13 847 6612', email: 'hassan@easternweld.sa', crNumber: '2050177440', address: 'Al Wahah District', city: 'Jubail' },
    { name: 'Gulf Scaffolding Group', type: 'subcontractor', contactPerson: 'Fahad Al-Ghamdi', phone: '+966 13 882 9034', email: 'fahad@gulfscaffold.com', address: 'Industrial Area 4', city: 'Dammam' },
    { name: 'Marafeq Jubail Facility Services', type: 'subcontractor', contactPerson: 'Nasser Al-Buqami', phone: '+966 13 814 5500', email: 'contact@marafeqjubail.sa', address: 'Jubail Industrial City 2', city: 'Jubail' },
    { name: 'Sadara Chemical Company', type: 'client', contactPerson: 'Procurement Dept.', phone: '+966 13 359 7777', email: 'procurement@sadara.com', address: 'Jubail Industrial City 2', city: 'Jubail', notes: 'Potential client — prequalification in progress.' },
    { name: 'Almarai Food Co.', type: 'client', contactPerson: 'Ahmed Al-Salem', phone: '+966 11 470 5555', email: 'ahmed.salem@almarai.com', address: 'King Fahd Road', city: 'Riyadh', notes: 'Requested quote for facility maintenance staff.' },
    { name: 'Rawabi Holding', type: 'client', contactPerson: 'Majed Al-Rawabi', phone: '+966 13 811 9900', email: 'majed@rawabi.com', address: 'Corniche Road', city: 'Al Khobar' },
    { name: 'Saudi Electricity Co. — Eastern', type: 'other', contactPerson: 'Customer Service', phone: '920001100', email: 'customercare@se.com.sa', address: 'Prince Faisal Bin Fahd Rd', city: 'Dammam', notes: 'Utility account 4471-8890 — site power connections.' },
    { name: 'Saudi Telecom (STC) — Jubail', type: 'other', contactPerson: 'Business Care', phone: '920001155', email: 'business@stc.com.sa', address: 'Al Huwailat District', city: 'Jubail', notes: 'Corporate mobile plan — 45 lines.' },
  ]
  for (const n of nameList) {
    await db.nameListEntry.create({
      data: {
        name: n.name, type: n.type, contactPerson: n.contactPerson, phone: n.phone,
        email: n.email, crNumber: n.crNumber ?? null, vatNumber: n.vatNumber ?? null,
        address: n.address, city: n.city, status: 'active', notes: n.notes ?? null,
      },
    })
  }
  console.log(`  ✓ ${nameList.length} name-list entries`)

  // ── VAT EXPENSE BILLS ─────────────────────────────────────────────────────
  const vatBills: { billDate: Date; billNumber: string; supplierName: string; description: string; amountWithVat: number }[] = [
    { billDate: d(2026, 7, 8), billNumber: 'SUP-2026-0107', supplierName: 'Al Khobar Steel Trading Est.', description: 'Structural steel & pipe supports', amountWithVat: 18400 },
    { billDate: d(2026, 7, 19), billNumber: 'SUP-2026-0118', supplierName: 'Jubail Safety Equipment Co.', description: 'PPE replenishment — helmets & gloves', amountWithVat: 4255 },
    { billDate: d(2026, 7, 28), billNumber: 'PET-2026-0791', supplierName: 'Petromin Lubricants', description: 'Diesel — site generators & vehicles', amountWithVat: 9775 },
    { billDate: d(2026, 8, 4), billNumber: 'SUP-2026-0126', supplierName: 'Dammam Industrial Supplies', description: 'Power tools & extension cords', amountWithVat: 6110 },
    { billDate: d(2026, 8, 16), billNumber: 'RNT-2026-0453', supplierName: 'Heavy Equipment Rental Co.', description: 'Forklift rental — August (2 units)', amountWithVat: 15870 },
    { billDate: d(2026, 8, 27), billNumber: 'SUP-2026-0133', supplierName: 'Riyadh Workwear Ltd.', description: 'Coveralls — Metro Line 4 crew', amountWithVat: 5175 },
    { billDate: d(2026, 9, 3), billNumber: 'SUP-2026-0141', supplierName: 'Al Khobar Steel Trading Est.', description: 'Welding consumables & electrodes', amountWithVat: 11600 },
    { billDate: d(2026, 9, 15), billNumber: 'SRV-2026-0322', supplierName: 'Jubail Vehicle Maintenance', description: 'Pickup fleet service — 6 vehicles', amountWithVat: 7360 },
    { billDate: d(2026, 9, 29), billNumber: 'TEL-2026-0915', supplierName: 'Saudi Telecom (STC)', description: 'Corporate mobile & internet — Q3', amountWithVat: 2392 },
    { billDate: d(2026, 10, 6), billNumber: 'SUP-2026-0149', supplierName: 'Jubail Safety Equipment Co.', description: 'Safety shoes & harnesses — NEOM batch', amountWithVat: 9200 },
    { billDate: d(2026, 10, 14), billNumber: 'RNT-2026-0488', supplierName: 'Heavy Equipment Rental Co.', description: 'Forklift rental — October (2 units)', amountWithVat: 15870 },
    { billDate: d(2026, 10, 19), billNumber: 'SUP-2026-0155', supplierName: 'Dammam Industrial Supplies', description: 'Site lighting & small tools', amountWithVat: 3680 },
  ]
  for (const b of vatBills) {
    const amountWithoutVat = round2(b.amountWithVat / (1 + VAT))
    await db.vatExpenseBill.create({
      data: {
        billDate: b.billDate, billNumber: b.billNumber, supplierName: b.supplierName,
        description: b.description, amountWithVat: b.amountWithVat,
        amountWithoutVat, vatAmount: round2(b.amountWithVat - amountWithoutVat),
        vatRateSnapshot: VAT, createdById: admin?.id ?? null,
      },
    })
  }
  console.log(`  ✓ ${vatBills.length} VAT expense bills (Q3 + Q4 2026)`)

  // ── WORKER ADVANCES ───────────────────────────────────────────────────────
  const expCat =
    (await db.transactionCategory.findFirst({ where: { name: 'Advance to Workers' } })) ??
    (await db.transactionCategory.create({ data: { name: 'Advance to Workers', type: 'expense' } }))
  const recCat =
    (await db.transactionCategory.findFirst({ where: { name: 'Advance Recovery' } })) ??
    (await db.transactionCategory.create({ data: { name: 'Advance Recovery', type: 'income' } }))

  const staff = await db.staff.findMany({
    where: { deletedAt: null, status: 'active' },
    select: { id: true, fullName: true },
    orderBy: { createdAt: 'asc' },
  })
  const byStaff = (frag: string) => staff.find((s) => s.fullName.includes(frag))!
  const rafiq = byStaff('Muhammad Rafiq')
  const rajesh = byStaff('Rajesh Nair')
  const anil = byStaff('Anil Menon')
  const nasir = byStaff('Nasir')
  const ashraf = byStaff('Mohammed Ashraf')

  // PAID September payrolls — deductions land on these (they exist + are locked)
  const paidPayrolls = await db.payroll.findMany({
    where: { month: 9, year: 2026, status: 'paid' },
    include: { staff: { select: { id: true, fullName: true } } },
    orderBy: { createdAt: 'asc' },
  })

  async function createAdvance(opts: {
    staffId: string; fullName: string; amount: number; givenDate: Date
    deductionMonth: number; deductionYear: number; installments: number
    deductedAmount: number; paymentMethod?: string; reference?: string
  }) {
    const share = round2(opts.amount / opts.installments)
    const deducted = round2(opts.deductedAmount ?? 0)
    const tx = await db.transaction.create({
      data: {
        type: 'expense',
        title: `Advance Payment: ${opts.fullName}`,
        amount: round2(opts.amount),
        transactionCategoryId: expCat.id,
        operatorUserId: admin?.id ?? null,
        transactionDate: opts.givenDate,
        description: `Worker advance — deduction starts ${opts.deductionMonth}/${opts.deductionYear}${opts.reference ? ` — ${opts.reference}` : ''}`,
        expenseMonth: opts.givenDate.getUTCMonth() + 1,
        expenseYear: opts.givenDate.getUTCFullYear(),
      },
    })
    const status = deducted <= 0.005 ? 'pending'
      : deducted >= opts.amount - 0.005 ? 'deducted'
      : 'partially_deducted'
    return db.workerAdvance.create({
      data: {
        staffId: opts.staffId, amount: round2(opts.amount), givenDate: opts.givenDate,
        paymentMethod: opts.paymentMethod ?? 'cash', reference: opts.reference ?? null,
        deductionMonth: opts.deductionMonth, deductionYear: opts.deductionYear,
        installments: opts.installments, deductedAmount: deducted,
        status, transactionId: tx.id, createdById: admin?.id ?? null,
      },
    })
  }

  // a) Fully-deducted advance — single September installment on Anil's PAID
  //    payroll (real deduction row + recovery entry; locked by the module)
  const anilPayroll = paidPayrolls.find((p) => p.staffId === anil.id)!
  await applyPartial({ staffId: anil.id, fullName: anil.fullName, amount: 2000, installments: 1 }, anilPayroll)

  // b) Two advances partially deducted on September PAID payrolls (full accounting)
  //    Targets MUST have legacy advance = 0 so the module's stale detection stays green
  const cleanPaid = paidPayrolls.filter(
    (p) => p.advance === 0 && ![rafiq.id, anil.id].includes(p.staffId)
  )
  const target1 = cleanPaid.find((p) => p.staffId === rajesh.id) ?? cleanPaid[0]
  const rest = cleanPaid.filter((p) => p.id !== target1.id)
  const target2 = rest.find((p) => p.staffId === nasir.id) ?? rest[0] ?? target1

  async function applyPartial(advOpts: { staffId: string; fullName: string; amount: number; installments: number }, payroll: Payroll & { staff: { fullName: string } }) {
    const share = round2(advOpts.amount / advOpts.installments)
    const advance = await createAdvance({
      ...advOpts,
      givenDate: d(2026, 8, 22),
      deductionMonth: 9,
      deductionYear: 2026,
      deductedAmount: share,
    })
    const recovery = await db.transaction.create({
      data: {
        type: 'income',
        title: `Advance Recovery: ${advOpts.fullName}`,
        amount: share,
        transactionCategoryId: recCat.id,
        operatorUserId: admin?.id ?? null,
        transactionDate: payroll.payDate ?? d(2026, 10, 5),
        description: `Recovered from September 2026 payroll`,
        expenseMonth: 9,
        expenseYear: 2026,
      },
    })
    await db.payrollAdvanceDeduction.create({
      data: { payrollId: payroll.id, advanceId: advance.id, amount: share, recoveryTransactionId: recovery.id },
    })
    await db.payroll.update({
      where: { id: payroll.id },
      data: {
        advance: round2(payroll.advance + share),
        totalDeductions: round2(payroll.totalDeductions + share),
        netPay: round2(payroll.netPay - share),
      },
    })
    // keep the linked salary expense consistent with the new net
    // (the FK lives on Transaction.payrollId — unique back-relation)
    const linkedSalary = await db.transaction.findUnique({ where: { payrollId: payroll.id } })
    if (linkedSalary) {
      await db.transaction.update({ where: { id: linkedSalary.id }, data: { amount: round2(payroll.netPay - share) } })
    }
    return { name: advOpts.fullName, share, netAfter: round2(payroll.netPay - share) }
  }

  const applied1 = await applyPartial({ staffId: target1.staffId, fullName: target1.staff.fullName, amount: 1200, installments: 2 }, target1)
  const applied2 = await applyPartial({ staffId: target2.staffId, fullName: target2.staff.fullName, amount: 1000, installments: 2 }, target2)

  // c) Two fresh pending advances (October — will deduct from upcoming payrolls)
  await createAdvance({ staffId: rafiq.id, fullName: rafiq.fullName, amount: 1500, givenDate: d(2026, 10, 8), deductionMonth: 10, deductionYear: 2026, installments: 3, reference: 'House repair — Chittagong' })
  await createAdvance({ staffId: ashraf.id, fullName: ashraf.fullName, amount: 800, givenDate: d(2026, 10, 17), deductionMonth: 11, deductionYear: 2026, installments: 2, paymentMethod: 'bank_transfer' })
  console.log(`  ✓ 5 worker advances (1 deducted: Anil Menon -2000, 2 partial on Sep payroll: ${applied1.name} -${applied1.share}, ${applied2.name} -${applied2.share}, 2 pending)`)

  // ── ACTIVITY LOG ──────────────────────────────────────────────────────────
  // Idempotent: wipe this script's seeded doc/advance entries first (these
  // modules had zero rows before the restore — only this script writes them)
  await db.activityLog.deleteMany({
    where: { module: { in: ['quotation', 'invoice', 'supplier_po', 'agreement', 'vat_return', 'advance'] } },
  })
  await db.activityLog.createMany({
    data: [
      { userId: admin?.id ?? null, userName: 'Landmark Admin', action: 'created', module: 'quotation', description: 'Quotation QTN-2026-0002 created — Al Waha Engineering Group', amount: 48935, createdAt: d(2026, 9, 1, 10, 30) },
      { userId: admin?.id ?? null, userName: 'Landmark Admin', action: 'created', module: 'invoice', description: 'Invoice INV-2026-0002 issued — Al Waha Engineering Group', amount: 48935, createdAt: d(2026, 10, 2, 11, 15) },
      { userId: admin?.id ?? null, userName: 'Landmark Admin', action: 'created', module: 'supplier_po', description: 'Supplier PO PO-2026-0002 ordered — Jubail Safety Equipment Co.', amount: 14625, createdAt: d(2026, 9, 26, 9, 45) },
      { userId: admin?.id ?? null, userName: 'Landmark Admin', action: 'created', module: 'agreement', description: 'Agreement AGR-2026-0001 signed — Al Waha Engineering Group', amount: 1468080, createdAt: d(2026, 9, 2, 14, 0) },
      { userId: admin?.id ?? null, userName: 'Landmark Admin', action: 'created', module: 'vat_return', description: 'VAT bill SUP-2026-0155 recorded — Dammam Industrial Supplies', amount: 3680, createdAt: d(2026, 10, 19, 12, 20) },
      { userId: admin?.id ?? null, userName: 'Landmark Admin', action: 'created', module: 'advance', description: 'Advance given: Muhammad Rafiq — SAR 1,500 (deduction 10/2026)', amount: 1500, createdAt: d(2026, 10, 8, 13, 30) },
    ],
  })
  console.log('  ✓ activity log entries')

  console.log('\n✅ Restore complete!')
  console.log('   Quotations: 5 · Invoices: 5 · Supplier POs: 4 · Agreements: 3')
  console.log('   Name list: 12 · VAT bills: 12 · Worker advances: 5')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => db.$disconnect())
