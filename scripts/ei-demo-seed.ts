// Demo data seeder for the E-Invoice module — creates demo clients and a set
// of bilingual demo e-invoices covering every state the boss wants to preview:
//
//   1. Phase 1 · issued · partially paid · OVERDUE  (Al Rushaid)
//   2. Phase 1 · draft                              (Gulf Steel, 0% VAT line)
//   3. Phase 2 · issued · submitted → CLEARED       (Jubail Technical)
//   4. Phase 2 · issued · not submitted yet         (Al Rushaid)
//   5. Phase 2 · draft                              (Gulf Steel)
//
// Everything goes through the REAL API routes (create → issue → payments →
// ZATCA report), so totals, the PIH hash chain, the ECDSA stamps and the
// simulation clearance are all produced by the actual server logic.
//
// Run: bun run scripts/ei-demo-seed.ts
const BASE = 'http://localhost:3000'
const EMAIL = 'admin@landmarkintergulf.com'
const PASSWORD = 'Landmark@2025'

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

type Client = { id: string; name: string }

async function ensureClient(
  existingByName: Map<string, string>,
  payload: Record<string, unknown>
): Promise<Client> {
  const existingId = existingByName.get(String(payload.name))
  if (existingId) {
    console.log(`  · client "${String(payload.name)}" already exists — skipped`)
    return { id: existingId, name: String(payload.name) }
  }
  const created = await api<{ id: string; name: string }>('POST', '/api/clients', payload)
  if (!okStatus(created.status)) {
    fail(`create client ${String(payload.name)}`, created.status, created.json)
  }
  console.log(`  ✓ client "${created.json.name}" saved`)
  return { id: created.json.id, name: created.json.name }
}

type ExistingInvoice = { id: string; status: string; zatcaStatus?: string | null }

/** Find an existing demo invoice by its unique P.O. reference (idempotency). */
async function findByPoRef(poRef: string): Promise<ExistingInvoice | null> {
  const res = await api<{ rows?: ExistingInvoice[] }>(
    'GET',
    `/api/e-invoices?search=${encodeURIComponent(poRef)}`
  )
  return res.json.rows?.[0] ?? null
}

/**
 * Create a demo draft (or reuse the existing one). Returns the id + whether
 * the document was freshly created (drives issue/payment/zatca steps).
 */
async function createDraft(
  poRef: string,
  payload: Record<string, unknown>
): Promise<{ id: string; fresh: boolean; existing: ExistingInvoice | null }> {
  const existing = await findByPoRef(poRef)
  if (existing) {
    console.log(`  · ${poRef} already exists (${existing.status}) — skipped`)
    return { id: existing.id, fresh: false, existing }
  }
  const res = await api<{ id: string; invoiceNumber: string }>('POST', '/api/e-invoices', payload)
  if (!okStatus(res.status)) {
    fail(`create e-invoice ${String(payload.clientNameEn)}`, res.status, res.json)
  }
  console.log(`  ✓ draft ${res.json.invoiceNumber} created`)
  return { id: res.json.id, fresh: true, existing: null }
}

async function issue(id: string, label: string, fresh: boolean, existing: ExistingInvoice | null): Promise<void> {
  if (!fresh && existing && existing.status !== 'draft') return
  const res = await api<{ invoiceNumber: string }>('POST', `/api/e-invoices/${id}/issue`, {})
  if (!okStatus(res.status)) fail(`issue ${label}`, res.status, res.json)
  console.log(`  ✓ ${label} issued (locked + stamped)`)
}

async function addPayment(
  id: string,
  amount: number,
  date: string,
  ref: string,
  fresh: boolean
): Promise<void> {
  if (!fresh) return // already-issued demo → assume its payments exist too
  const res = await api('POST', `/api/e-invoices/${id}/payments`, {
    amount,
    paymentDate: date,
    methodEn: 'Bank transfer',
    methodAr: 'تحويل بنكي',
    reference: ref,
  })
  if (!okStatus(res.status)) fail(`payment on ${id}`, res.status, res.json)
  console.log(`  ✓ payment SAR ${amount.toFixed(2)} recorded (${ref})`)
}

async function submitZatca(
  id: string,
  label: string,
  fresh: boolean,
  existing: ExistingInvoice | null
): Promise<void> {
  if (!fresh && existing?.zatcaStatus) return
  const res = await api<{ zatcaStatus: string; mode: string }>(
    'POST',
    `/api/e-invoices/${id}/zatca/report`,
    {}
  )
  if (!okStatus(res.status)) fail(`ZATCA report ${label}`, res.status, res.json)
  console.log(`  ✓ ${label} submitted to ZATCA (${res.json.mode}) → ${res.json.zatcaStatus}`)
}

async function main() {
  console.log('— E-Invoice demo seed —')

  // 0 ─ login
  const login = await api<{ token?: string }>('POST', '/api/auth/login', {
    email: EMAIL,
    password: PASSWORD,
  })
  if (login.status !== 200 || !login.json.token) fail('login', login.status, login.json)
  token = login.json.token as string
  console.log('  ✓ logged in as admin')

  // 1 ─ demo clients (saved permanently in the Clients module)
  console.log('— clients —')
  const clientsRes = await api<{ data?: Array<{ id: string; name: string }> }>(
    'GET',
    '/api/clients?pageSize=200'
  )
  const existingByName = new Map((clientsRes.json.data ?? []).map((c) => [c.name, c.id]))
  const alRushaid = await ensureClient(existingByName, {
    name: 'Al Rushaid Construction Co.',
    nameAr: 'شركة الرشيد للإنشاءات المحدودة',
    contactPerson: 'Eng. Faisal Al Rushaid',
    phone: '+966 13 555 0140',
    email: 'accounts@alrushaid.example.com',
    city: 'Dammam',
    address: 'Prince Mohammed Bin Fahd Road, Al Faisaliyah, Dammam 32241, Saudi Arabia',
    vatNumber: '310287456300003',
    crNumber: '2050144772',
  })
  const gulfSteel = await ensureClient(existingByName, {
    name: 'Gulf Steel Industries Co.',
    nameAr: 'شركة الخليج للصناعات الحديدية',
    contactPerson: 'Mr. Omar Al Harbi',
    phone: '+966 13 555 0177',
    email: 'finance@gulfsteel.example.com',
    city: 'Jubail',
    address: 'Industrial City 2, Jubail 31961, Saudi Arabia',
    vatNumber: '300193847500003',
    crNumber: '2050098314',
  })
  const jubailTech = await ensureClient(existingByName, {
    name: 'Jubail Technical Services Co.',
    nameAr: 'شركة خدمات الجبيل الفنية',
    contactPerson: 'Eng. Salem Al Qahtani',
    phone: '+966 13 555 0122',
    email: 'ap@jubailtech.example.com',
    city: 'Jubail',
    address: 'Jubail Commercial Port Area, Jubail 35714, Saudi Arabia',
    vatNumber: '310447128900003',
    crNumber: '2050221758',
  })

  // 2 ─ demo e-invoices
  console.log('— e-invoices —')

  // (1) Phase 1 · issued · partially paid · overdue
  const d1 = await createDraft('PO-2025-0413', {
    docType: 'invoice',
    zatcaPhase: 1,
    clientId: alRushaid.id,
    clientNameEn: 'Al Rushaid Construction Co.',
    clientNameAr: 'شركة الرشيد للإنشاءات المحدودة',
    clientVatNumber: '310287456300003',
    clientCrNumber: '2050144772',
    clientAddressEn: 'Prince Mohammed Bin Fahd Road, Al Faisaliyah, Dammam 32241, Saudi Arabia',
    clientAddressAr: 'طريق الأمير محمد بن فهد، الفيصلية، الدمام 32241، المملكة العربية السعودية',
    poRef: 'PO-2025-0413',
    contractRef: 'MMC-AR-114',
    projectEn: 'Dammam Warehouse Complex — Phase 2',
    projectAr: 'مجمع مستودعات الدمام — المرحلة الثانية',
    paymentTermsEn: '45 days from invoice date',
    paymentTermsAr: '٤٥ يوماً من تاريخ الفاتورة',
    paymentMethodEn: 'Bank transfer',
    paymentMethodAr: 'تحويل بنكي',
    issueDate: daysAgo(52),
    supplyDate: daysAgo(50),
    dueDate: daysAgo(7),
    notesEn: 'Manpower deployed as per the approved monthly deployment plan.',
    notesAr: 'تم توريد العمالة وفق خطة التوزيع الشهرية المعتمدة.',
    items: [
      {
        descriptionEn: 'Manpower Supply — General Laborers',
        descriptionAr: 'توريد العمالة — عمال عموميون',
        unitEn: 'Man-Month',
        unitAr: 'شهر/فرد',
        quantity: 25,
        unitPrice: 3200,
        vatPercent: 15,
      },
      {
        descriptionEn: 'Manpower Supply — Scaffolders',
        descriptionAr: 'توريد العمالة — سقالون',
        unitEn: 'Man-Month',
        unitAr: 'شهر/فرد',
        quantity: 8,
        unitPrice: 3900,
        discount: 1200,
        vatPercent: 15,
      },
    ],
  })
  await issue(d1.id, 'E-INVOICE DEMO 1 (Phase 1, overdue)', d1.fresh, d1.existing)
  await addPayment(d1.id, 50000, daysAgo(30), 'TT-88214', d1.fresh)

  // (2) Phase 1 · draft
  await createDraft('PO-2025-0518', {
    docType: 'invoice',
    zatcaPhase: 1,
    clientId: gulfSteel.id,
    clientNameEn: 'Gulf Steel Industries Co.',
    clientNameAr: 'شركة الخليج للصناعات الحديدية',
    clientVatNumber: '300193847500003',
    clientCrNumber: '2050098314',
    clientAddressEn: 'Industrial City 2, Jubail 31961, Saudi Arabia',
    clientAddressAr: 'المدينة الصناعية ٢، الجبيل ٣١٩٦١، المملكة العربية السعودية',
    poRef: 'PO-2025-0518',
    projectEn: 'Steel Structure Maintenance Support',
    projectAr: 'دعم صيانة الهياكل الحديدية',
    paymentTermsEn: '30 days from invoice date',
    paymentTermsAr: '٣٠ يوماً من تاريخ الفاتورة',
    issueDate: daysAgo(3),
    dueDate: daysFromNow(27),
    items: [
      {
        descriptionEn: 'Manpower Supply — Certified Welders (6G)',
        descriptionAr: 'توريد العمالة — لحّامون معتمدون (٦ج)',
        unitEn: 'Man-Month',
        unitAr: 'شهر/فرد',
        quantity: 12,
        unitPrice: 4800,
        vatPercent: 15,
      },
      {
        descriptionEn: 'Overseas secondment — QA/QC Inspector (export service)',
        descriptionAr: 'إعارة خارجية — مفتش ضبط الجودة (خدمة تصدير)',
        unitEn: 'EA',
        unitAr: 'عدد',
        quantity: 1,
        unitPrice: 9500,
        vatPercent: 0,
      },
    ],
  })
  console.log('  ✓ E-INVOICE DEMO 2 (Phase 1, draft) left as draft')

  // (3) Phase 2 · issued · submitted → cleared (simulation)
  const d3 = await createDraft('PO-2025-0392', {
    docType: 'invoice',
    zatcaPhase: 2,
    clientId: jubailTech.id,
    clientNameEn: 'Jubail Technical Services Co.',
    clientNameAr: 'شركة خدمات الجبيل الفنية',
    clientVatNumber: '310447128900003',
    clientCrNumber: '2050221758',
    clientAddressEn: 'Jubail Commercial Port Area, Jubail 35714, Saudi Arabia',
    clientAddressAr: 'منطقة ميناء الجبيل التجاري، الجبيل ٣٥٧١٤، المملكة العربية السعودية',
    poRef: 'PO-2025-0392',
    contractRef: 'SVC-JT-207',
    projectEn: 'Jubail Port Maintenance Campaign',
    projectAr: 'حملة صيانة ميناء الجبيل',
    paymentTermsEn: '60 days from invoice date',
    paymentTermsAr: '٦٠ يوماً من تاريخ الفاتورة',
    paymentMethodEn: 'Bank transfer',
    paymentMethodAr: 'تحويل بنكي',
    issueDate: daysAgo(21),
    supplyDate: daysAgo(21),
    dueDate: daysFromNow(39),
    items: [
      {
        descriptionEn: 'Manpower Supply — Mechanical Technicians',
        descriptionAr: 'توريد العمالة — فنيون ميكانيكيون',
        unitEn: 'Man-Month',
        unitAr: 'شهر/فرد',
        quantity: 18,
        unitPrice: 4300,
        vatPercent: 15,
      },
      {
        descriptionEn: 'Manpower Supply — Industrial Cleaners',
        descriptionAr: 'توريد العمالة — منظفون صناعيون',
        unitEn: 'Man-Month',
        unitAr: 'شهر/فرد',
        quantity: 10,
        unitPrice: 2600,
        vatPercent: 15,
      },
      {
        descriptionEn: 'Site Safety Supervisor — Lump Sum',
        descriptionAr: 'مشرف سلامة موقع — مقطوعية',
        unitEn: 'LS',
        unitAr: 'مقطوعية',
        quantity: 1,
        unitPrice: 15000,
        vatPercent: 15,
      },
    ],
  })
  await issue(d3.id, 'E-INVOICE DEMO 3 (Phase 2)', d3.fresh, d3.existing)
  await submitZatca(d3.id, 'E-INVOICE DEMO 3', d3.fresh, d3.existing)
  await addPayment(d3.id, 60000, daysAgo(10), 'TT-90112', d3.fresh)

  // (4) Phase 2 · issued · not submitted yet
  const d4 = await createDraft('PO-2025-0561', {
    docType: 'invoice',
    zatcaPhase: 2,
    clientId: alRushaid.id,
    clientNameEn: 'Al Rushaid Construction Co.',
    clientNameAr: 'شركة الرشيد للإنشاءات المحدودة',
    clientVatNumber: '310287456300003',
    clientCrNumber: '2050144772',
    clientAddressEn: 'Prince Mohammed Bin Fahd Road, Al Faisaliyah, Dammam 32241, Saudi Arabia',
    clientAddressAr: 'طريق الأمير محمد بن فهد، الفيصلية، الدمام ٣٢٢٤١، المملكة العربية السعودية',
    poRef: 'PO-2025-0561',
    contractRef: 'MMC-AR-118',
    projectEn: 'Dammam Warehouse Complex — Phase 2',
    projectAr: 'مجمع مستودعات الدمام — المرحلة الثانية',
    paymentTermsEn: '30 days from invoice date',
    paymentTermsAr: '٣٠ يوماً من تاريخ الفاتورة',
    issueDate: daysAgo(5),
    dueDate: daysFromNow(25),
    items: [
      {
        descriptionEn: 'Manpower Supply — Electricians',
        descriptionAr: 'توريد العمالة — كهربائيون',
        unitEn: 'Man-Month',
        unitAr: 'شهر/فرد',
        quantity: 14,
        unitPrice: 4100,
        vatPercent: 15,
      },
    ],
  })
  await issue(d4.id, 'E-INVOICE DEMO 4 (Phase 2, pending submission)', d4.fresh, d4.existing)

  // (5) Phase 2 · draft
  await createDraft('PO-2025-0602', {
    docType: 'invoice',
    zatcaPhase: 2,
    clientId: gulfSteel.id,
    clientNameEn: 'Gulf Steel Industries Co.',
    clientNameAr: 'شركة الخليج للصناعات الحديدية',
    clientVatNumber: '300193847500003',
    clientCrNumber: '2050098314',
    clientAddressEn: 'Industrial City 2, Jubail 31961, Saudi Arabia',
    clientAddressAr: 'المدينة الصناعية ٢، الجبيل ٣١٩٦١، المملكة العربية السعودية',
    poRef: 'PO-2025-0602',
    projectEn: 'Crane Operators Support',
    projectAr: 'دعم مشغلي الرافعات',
    issueDate: daysAgo(1),
    dueDate: daysFromNow(29),
    items: [
      {
        descriptionEn: 'Manpower Supply — Certified Crane Operators',
        descriptionAr: 'توريد العمالة — مشغلو رافعات معتمدون',
        unitEn: 'Man-Month',
        unitAr: 'شهر/فرد',
        quantity: 6,
        unitPrice: 5500,
        vatPercent: 15,
      },
    ],
  })
  console.log('  ✓ E-INVOICE DEMO 5 (Phase 2, draft) left as draft')

  console.log('\nDemo seed complete — open E-Invoices in the app to preview.')
}

main().catch((err) => {
  console.error('Seed failed:', err)
  process.exit(1)
})
