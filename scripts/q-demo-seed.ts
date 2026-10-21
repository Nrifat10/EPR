// Demo data seeder for the Quotation module — reproduces the boss's template
// (upload/Quotation_Template.png) as a real quotation record:
//
//   Client:  Al Noor Development Company (Attn: Mr. Abdullah Al-Qahtani)
//   Project: Residential Complex – Dammam · 12 months contract
//   Items:   8 worker categories with Rate/Hour × 260 hrs = Rate/Worker/Month
//            → Monthly Subtotal 279,500 · VAT 15% 41,925 · TOTAL 321,425
//            → Contract Value (12 Months) 3,857,100
//
// Everything goes through the REAL API routes so totals are computed by the
// actual server logic. Idempotent: skips when the demo reference already
// exists.
//
// Run: bun run scripts/q-demo-seed.ts
export {} // module scope — keeps the script's top-level names out of other seed scripts

const BASE = 'http://localhost:3000'
const EMAIL = 'admin@landmarkintergulf.com'
const PASSWORD = 'Landmark@2025'
const DEMO_REF = 'RFQ-AN-118'

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

// ── The boss's template items: rate/hour × 260 hrs/month ────────────────────
const TEMPLATE_ITEMS: Array<{
  description: string
  subText: string
  quantity: number
  ratePerHour: number
  hoursPerMonth: number
}> = [
  { description: 'Electrician', subText: 'Licensed, SCE-classified', quantity: 10, ratePerHour: 18, hoursPerMonth: 260 },
  { description: 'Plumber', subText: 'Pipe fitting & sanitary', quantity: 6, ratePerHour: 17, hoursPerMonth: 260 },
  { description: 'Mason', subText: 'Block work & plastering', quantity: 12, ratePerHour: 16, hoursPerMonth: 260 },
  { description: 'Carpenter', subText: 'Shuttering & formwork', quantity: 8, ratePerHour: 16, hoursPerMonth: 260 },
  { description: 'Steel Fixer', subText: 'Rebar cutting & fixing', quantity: 10, ratePerHour: 15.5, hoursPerMonth: 260 },
  { description: 'General Helper', subText: 'Site labour', quantity: 20, ratePerHour: 12, hoursPerMonth: 260 },
  { description: 'Foreman', subText: 'Site supervision', quantity: 2, ratePerHour: 25, hoursPerMonth: 260 },
  { description: 'Safety Officer', subText: 'HSE certified', quantity: 1, ratePerHour: 28, hoursPerMonth: 260 },
]

async function main(): Promise<void> {
  console.log('Quotation demo seeder — the boss\'s template as real data')

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

  // 2. ensure the demo client exists
  const clients = await api<{ data?: Array<{ id: string; name: string }> }>(
    'GET',
    '/api/clients?page=1&pageSize=200'
  )
  if (!okStatus(clients.status)) fail('list clients', clients.status, clients.json)
  const existing = (clients.json.data ?? []).find((c) => c.name === 'Al Noor Development Company')
  let clientId: string
  if (existing) {
    clientId = existing.id
    console.log('  · client "Al Noor Development Company" already exists — skipped')
  } else {
    const created = await api<{ id: string }>('POST', '/api/clients', {
      name: 'Al Noor Development Company',
      contactPerson: 'Mr. Abdullah Al-Qahtani',
      phone: '+966 13 800 0000',
      email: 'projects@alnoor.sa',
      address: 'King Fahd Rd., Dammam 32241',
      city: 'Dammam',
      vatNumber: '310311223300003',
      crNumber: '2050168743',
    })
    if (!okStatus(created.status)) fail('create client', created.status, created.json)
    clientId = created.json.id
    console.log('  ✓ client "Al Noor Development Company" saved')
  }

  // 3. idempotency — skip when the demo quotation already exists
  const quotes = await api<{ data?: Array<{ id: string; referenceNo: string | null }> }>(
    'GET',
    `/api/quotations?page=1&pageSize=200&search=${encodeURIComponent(DEMO_REF)}`
  )
  if (!okStatus(quotes.status)) fail('list quotations', quotes.status, quotes.json)
  const already = (quotes.json.data ?? []).find((q) => q.referenceNo === DEMO_REF)
  if (already) {
    console.log(`  · demo quotation (ref ${DEMO_REF}) already exists — nothing to do`)
    return
  }

  // 4. create the quotation (totals computed server-side)
  const issueDate = daysAgo(0)
  const created = await api<{ id: string; quoteNumber: string; subtotal: number; vatAmount: number; total: number }>(
    'POST',
    '/api/quotations',
    {
      clientId,
      clientName: 'Al Noor Development Company',
      subject: 'Manpower Supply Proposal',
      referenceNo: DEMO_REF,
      issueDate,
      validityDate: daysFromNow(30),
      status: 'sent',
      vatRate: 0.15,
      discount: 0,
      projectName: 'Residential Complex – Dammam',
      projectLocation: 'Al Faisaliyah, Dammam',
      contractPeriod: '12 Months',
      contractMonths: 12,
      mobilization: '7 days from P.O.',
      inclusions:
        'Salary, Iqama & GOSI\nAccommodation & transport\nMedical insurance & basic PPE',
      exclusions: 'Tools & special equipment\nSite gate passes & permits\nFood at site',
      terms:
        'Rates are based on 10 working hours/day, 26 days/month.\nOvertime will be charged at 1.25 × the hourly rate; holidays at 1.5 ×.\nInvoicing monthly based on approved timesheets; payment within 30 days.\nMinimum contract period: 3 months. Replacement of any worker within 72 hours.\nThis quotation is valid for 30 days from the date of issue.',
      notes: 'Mobilization within 7 days from receipt of the purchase order.',
      numberPrefix: 'QTN',
      items: TEMPLATE_ITEMS.map((it) => ({
        description: it.description,
        subText: it.subText,
        unit: 'Man-Month',
        quantity: it.quantity,
        ratePerHour: it.ratePerHour,
        hoursPerMonth: it.hoursPerMonth,
        unitPrice: Math.round(it.ratePerHour * it.hoursPerMonth * 100) / 100,
        discount: 0,
      })),
      assets: [],
    }
  )
  if (!okStatus(created.status)) fail('create quotation', created.status, created.json)

  const t = created.json
  console.log(
    `  ✓ quotation ${t.quoteNumber} created — subtotal ${t.subtotal.toLocaleString('en-US')} · VAT ${t.vatAmount.toLocaleString('en-US')} · total ${t.total.toLocaleString('en-US')}`
  )

  // sanity: the template numbers must match exactly
  const expectSubtotal = 279500
  const expectVat = 41925
  const expectTotal = 321425
  const checks: Array<[string, number, number]> = [
    ['subtotal', t.subtotal, expectSubtotal],
    ['VAT', t.vatAmount, expectVat],
    ['total', t.total, expectTotal],
  ]
  for (const [label, got, want] of checks) {
    if (Math.abs(got - want) > 0.01) {
      console.error(`  ✗ template mismatch: ${label} is ${got}, expected ${want}`)
      process.exit(1)
    }
  }
  console.log('  ✓ template totals verified: 279,500 / 41,925 / 321,425 (contract value 3,857,100 over 12 months)')
  console.log('Done — open Quotations → Preview to see the template design.')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
