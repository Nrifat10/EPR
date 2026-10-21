// Demo data seeder for the Supplier P.O. module — reproduces the boss's
// template (upload/Manpower_PO_Simple.png) as a real purchase order record:
//
//   Supplier: Riyadh Skilled Manpower Est. (Mr. Faisal Al-Otaibi)
//   Order:    PO Date 20/10/2026 · Quotation Ref QT-RS-2214 · Net 30 Days · SAR
//   Assignment: Dammam - Al Faisaliyah · starts 01/11/2026 · 6 months ·
//              10 hrs × 26 days
//   Items:    6 trades — AMOUNT = workers × hourly rate × 260 hrs/month
//            → Monthly Subtotal 151,060 · VAT 15% 22,659 · TOTAL/MONTH 173,719
//            → PO Value (6 Months) 1,042,314
//
// Everything goes through the REAL API routes so totals are computed by the
// actual server logic. Idempotent: skips when the demo P.O. already exists.
//
// Run: bun run scripts/po-demo-seed.ts
export {} // module scope — keeps the script's top-level names out of other seed scripts

const BASE = 'http://localhost:3000'
const EMAIL = 'admin@landmarkintergulf.com'
const PASSWORD = 'Landmark@2025'
const DEMO_QUOTE_REF = 'QT-RS-2214'

let token = ''

async function api<T = Record<string, unknown>>(
  method: string,
  path: string,
  body?: unknown
): Promise<{ status: number; json: T }> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })
  let json: T
  try {
    json = (await res.json()) as T
  } catch {
    json = {} as T
  }
  return { status: res.status, json }
}

const okStatus = (s: number): boolean => s >= 200 && s < 300

function fail(step: string, status: number, json: unknown): never {
  console.error(`  ✗ ${step} failed (${status})`, json)
  process.exit(1)
}

const daysAgo = (n: number): string => {
  const d = new Date(Date.now() - n * 86_400_000)
  return d.toISOString().slice(0, 10)
}
const daysFromNow = (n: number): string => daysAgo(-n)

// ── The boss's template trades: workers × hourly rate (× 260 hrs/month) ────
const TEMPLATE_ITEMS: Array<{ description: string; quantity: number; unitPrice: number }> = [
  { description: 'Electrician', quantity: 8, unitPrice: 16 },
  { description: 'Plumber', quantity: 4, unitPrice: 15 },
  { description: 'Mason', quantity: 10, unitPrice: 14 },
  { description: 'Steel Fixer', quantity: 6, unitPrice: 13.5 },
  { description: 'General Helper', quantity: 15, unitPrice: 10 },
  { description: 'Foreman', quantity: 1, unitPrice: 22 },
]

// ── Template TERMS (printed as two numbered columns) ────────────────────────
const TEMPLATE_TERMS = [
  'Valid Iqama / work permit / GOSI registration for every worker before mobilization.',
  'Accommodation, transport and food are the supplier\u2019s responsibility.',
  'Monthly invoice submitted against approved timesheets \u2014 payment within 30 days.',
  'Overtime work only with prior written approval from Landmark Inter Gulf.',
  'Absent or rejected workers replaced within 48 hours at the supplier\u2019s cost.',
  'Site HSE rules and PPE compliance are mandatory for all workers.',
  'ZATCA-compliant VAT tax invoice is required for every payment.',
].join('\n')

type ListResponse = {
  data: Array<{ id: string; poNumber: string; quotationRef: string | null }>
}

async function main(): Promise<void> {
  console.log('Supplier P.O. demo seeder — the boss\'s template as real data')

  // 1. login
  const login = await api<{ token?: string }>('POST', '/api/auth/login', {
    email: EMAIL,
    password: PASSWORD,
  })
  if (!okStatus(login.status) || !login.json.token) {
    fail('login', login.status, login.json)
  }
  token = login.json.token
  console.log('  ✓ logged in')

  // 2. idempotency check — the demo P.O. is identified by its quotation ref
  const existing = await api<ListResponse>('GET', `/api/supplier-pos?search=${encodeURIComponent('Riyadh Skilled Manpower')}&pageSize=100`)
  if (!okStatus(existing.status)) fail('list existing', existing.status, existing.json)
  const already = existing.json.data.find((p) => p.quotationRef === DEMO_QUOTE_REF)
  if (already) {
    console.log(`  ✓ demo P.O. already exists (${already.poNumber}) — nothing to do`)
    return
  }

  // 3. create the P.O. through the real API (server computes all money)
  const body = {
    supplierName: 'Riyadh Skilled Manpower Est.',
    supplierPhone: '+966 54 310 7788',
    attention: 'Mr. Faisal Al-Otaibi',
    supplierAddress: 'Al Malaz, Riyadh 12836, Saudi Arabia',
    supplierVat: '310444555600003',
    supplierCr: '1010 456 789',
    issueDate: daysAgo(1), // template: 20/10/2026
    quotationRef: DEMO_QUOTE_REF,
    paymentTerms: 'Net 30 Days',
    workSite: 'Dammam - Al Faisaliyah',
    startDate: daysFromNow(11), // template: 01/11/2026
    durationMonths: 6,
    workingHours: '10 hrs × 26 days',
    hoursPerMonth: 260,
    status: 'ordered',
    vatRate: 0.15,
    notes: TEMPLATE_TERMS,
    items: TEMPLATE_ITEMS.map((it) => ({
      description: it.description,
      quantity: it.quantity,
      unitPrice: it.unitPrice,
    })),
  }
  const created = await api<{ poNumber: string; subtotal: number; vatAmount: number; total: number }>(
    'POST',
    '/api/supplier-pos',
    body
  )
  if (!okStatus(created.status)) fail('create P.O.', created.status, created.json)

  const c = created.json
  console.log(`  ✓ created ${c.poNumber}`)
  console.log(
    `    subtotal ${c.subtotal.toLocaleString('en-US')} · VAT ${c.vatAmount.toLocaleString('en-US')} · total ${c.total.toLocaleString('en-US')}`
  )

  // 4. verify against the template's exact numbers
  const expect = { subtotal: 151_060, vat: 22_659, total: 173_719, poValue: 1_042_314 }
  const checks: Array<[string, boolean]> = [
    ['Monthly Subtotal = 151,060', c.subtotal === expect.subtotal],
    ['VAT 15% = 22,659', c.vatAmount === expect.vat],
    ['TOTAL / MONTH = 173,719', c.total === expect.total],
    ['PO Value (6 Months) = 1,042,314', Math.round(c.total * 6) === expect.poValue],
  ]
  let allOk = true
  for (const [label, passed] of checks) {
    console.log(`    ${passed ? '✓' : '✗'} ${label}`)
    if (!passed) allOk = false
  }
  if (!allOk) {
    console.error('  ✗ template verification failed')
    process.exit(1)
  }
  console.log('  ✓ all template numbers verified — open Supplier P.O. → Print to see the document')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
