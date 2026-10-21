// E2E test for the E-Invoice module backend (EI-A).
// Run: bun run scripts/ei-e2e.ts   (login as admin → Bearer token)
const BASE = 'http://localhost:3000'
const EMAIL = 'admin@landmarkintergulf.com'
const PASSWORD = 'Landmark@2025'

let token = ''
let passed = 0
let failed = 0
const failures: string[] = []

function check(name: string, cond: boolean, extra = '') {
  if (cond) {
    passed++
    console.log(`  ✓ ${name}`)
  } else {
    failed++
    failures.push(name)
    console.log(`  ✗ ${name} ${extra}`)
  }
}

async function api(
  method: string,
  path: string,
  body?: unknown
): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })
  let json: Record<string, unknown> = {}
  try {
    json = (await res.json()) as Record<string, unknown>
  } catch {
    json = {}
  }
  return { status: res.status, json }
}

/** Decode a TLV payload (mirrors tlvEncode) → [{tag, value}]. */
function tlvDecode(base64: string): { tag: number; value: string }[] {
  const buf = Buffer.from(base64, 'base64')
  const out: { tag: number; value: string }[] = []
  let i = 0
  while (i + 3 <= buf.length) {
    const tag = buf.readUInt8(i)
    const len = buf.readUInt16BE(i + 1)
    const value = buf.subarray(i + 3, i + 3 + len).toString('utf8')
    out.push({ tag, value })
    i += 3 + len
  }
  return out
}

// a tiny valid 1×1 red PNG
const TINY_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

async function main() {
  console.log('— login —')
  const login = await api('POST', '/api/auth/login', { email: EMAIL, password: PASSWORD })
  check('login 200', login.status === 200, `got ${login.status}`)
  token = String(login.json.token ?? '')
  check('token returned', token.length > 10)

  // 1 ─ empty list + zero totals
  console.log('— 1. empty list —')
  const list0 = await api('GET', '/api/e-invoices')
  check('GET list 200', list0.status === 200, `got ${list0.status}`)
  check('rows empty', Array.isArray(list0.json.rows) && (list0.json.rows as unknown[]).length === 0)
  const t0 = list0.json.totals as Record<string, number>
  check(
    'zero totals',
    t0.count === 0 && t0.totalDue === 0 && t0.paid === 0 && t0.outstanding === 0 && t0.overdueCount === 0 && t0.overdueAmount === 0
  )

  // 2 ─ create draft with 2 items (15% + 0% VAT)
  console.log('— 2. create draft —')
  const createBody = {
    clientNameEn: 'E2E Contracting Co',
    clientNameAr: '',
    clientVatNumber: '310000000000003',
    clientAddressEn: 'King Fahd Road, Riyadh',
    issueDate: '2026-06-15',
    dueDate: '2026-07-15',
    poRef: 'PO-2026-77',
    projectEn: 'Riyadh Metro Maintenance',
    items: [
      {
        descriptionEn: 'Manpower Supply — Electricians',
        quantity: 10,
        unitPrice: 400,
        discount: 200,
        vatPercent: 15,
        unitEn: 'EA',
      },
      {
        descriptionEn: 'Transportation service (zero-rated)',
        quantity: 2,
        unitPrice: 150,
        vatPercent: 0,
      },
    ],
  }
  const create = await api('POST', '/api/e-invoices', createBody)
  check('POST create 201', create.status === 201, `got ${create.status} ${JSON.stringify(create.json)}`)
  const inv = create.json as Record<string, unknown>
  check('number INV-2026-00001', inv.invoiceNumber === 'INV-2026-00001', `got ${inv.invoiceNumber}`)
  check('status draft', inv.status === 'draft')
  check('subtotal 4300', inv.subtotal === 4300, `got ${inv.subtotal}`)
  check('totalDiscount 200', inv.totalDiscount === 200, `got ${inv.totalDiscount}`)
  check('taxableAmount 4100', inv.taxableAmount === 4100, `got ${inv.taxableAmount}`)
  check('vatAmount 570', inv.vatAmount === 570, `got ${inv.vatAmount}`)
  check('totalDue 4670', inv.totalDue === 4670, `got ${inv.totalDue}`)
  const items = (inv.items as Record<string, number | string>[]) ?? []
  check('2 items', items.length === 2)
  check('line1 taxable 3800 vat 570 total 4370', items[0]?.taxableAmount === 3800 && items[0]?.vatAmount === 570 && items[0]?.lineTotal === 4370)
  check('line2 taxable 300 vat 0 total 300', items[1]?.taxableAmount === 300 && items[1]?.vatAmount === 0 && items[1]?.lineTotal === 300)
  const invId = String(inv.id)

  // 3 ─ PUT edit draft (change qty 10 → 12)
  console.log('— 3. edit draft —')
  const editBody = JSON.parse(JSON.stringify(createBody)) as typeof createBody
  ;(editBody.items[0] as { quantity: number }).quantity = 12
  const edit = await api('PUT', `/api/e-invoices/${invId}`, editBody)
  check('PUT edit 200', edit.status === 200, `got ${edit.status} ${JSON.stringify(edit.json)}`)
  check('subtotal recomputed 5100', edit.json.subtotal === 5100, `got ${edit.json.subtotal}`)
  check('vatAmount recomputed 690', edit.json.vatAmount === 690, `got ${edit.json.vatAmount}`)
  check('totalDue recomputed 5590', edit.json.totalDue === 5590, `got ${edit.json.totalDue}`)

  // restore qty 10 for later payment math (5590 → 4670)
  const restore = await api('PUT', `/api/e-invoices/${invId}`, createBody)
  check('restore qty 10 → totalDue 4670', restore.status === 200 && restore.json.totalDue === 4670)

  // 4 ─ translate (glossary + provider + skipped)
  console.log('— 4. translate pipeline —')
  const gCreate = await api('POST', '/api/glossary', {
    termEn: 'Manpower Supply',
    termAr: 'توريد العمالة',
    notes: 'E2E test term',
  })
  check('glossary POST 201', gCreate.status === 201, `got ${gCreate.status} ${JSON.stringify(gCreate.json)}`)
  const glossaryId = String(gCreate.json.id ?? '')

  const tr = await api('POST', '/api/e-invoices/translate', {
    entries: [
      { key: 'g1', text: 'Manpower Supply', context: 'description' },
      { key: 'g2', text: 'Manpower Supply — Electricians', context: 'description' },
      { key: 'p1', text: 'Site preparation and mobilization works', context: 'description' },
      { key: 's1', text: '1,200.00', context: 'generic' },
      { key: 's2', text: 'INV-2026-00001', context: 'generic' },
      { key: 's3', text: '310000000000003', context: 'generic' },
    ],
  })
  check('translate 200', tr.status === 200, `got ${tr.status}`)
  const results = (tr.json.results as { key: string; translated: string; source: string }[]) ?? []
  check('6 results', results.length === 6, `got ${results.length}`)
  const byKey = Object.fromEntries(results.map((r) => [r.key, r]))
  check('g1 exact glossary', byKey.g1?.source === 'glossary' && byKey.g1?.translated === 'توريد العمالة', JSON.stringify(byKey.g1))
  check(
    'g2 partial→provider or full glossary (not failed/skipped)',
    (byKey.g2?.source === 'provider' || byKey.g2?.source === 'glossary' || byKey.g2?.source === 'memory') && Boolean(byKey.g2?.translated),
    JSON.stringify(byKey.g2)
  )
  if (byKey.g2?.source === 'failed') {
    console.log(`    (providerError: ${String(tr.json.providerError)})`)
  }
  check(
    'p1 provider (builtin z-ai) translated',
    (byKey.p1?.source === 'provider' || byKey.p1?.source === 'memory') && /[\u0600-\u06FF]/.test(byKey.p1?.translated ?? ''),
    JSON.stringify(byKey.p1)
  )
  check('s1 number skipped', byKey.s1?.source === 'skipped')
  check('s2 ref skipped', byKey.s2?.source === 'skipped')
  check('s3 VAT skipped', byKey.s3?.source === 'skipped')
  check('no 500 on provider failure — translate always 200', tr.status === 200)

  // 5 ─ issue
  console.log('— 5. issue —')
  const issue = await api('POST', `/api/e-invoices/${invId}/issue`)
  check('issue 200', issue.status === 200, `got ${issue.status} ${JSON.stringify(issue.json)}`)
  check('status issued', issue.json.status === 'issued')
  check('uuid set', typeof issue.json.uuid === 'string' && String(issue.json.uuid).length === 36)
  check('icv 1', issue.json.icv === 1, `got ${issue.json.icv}`)
  check('previousHash = ZATCA_INITIAL_PIH', issue.json.previousHash === 'NWZlY2ViNjZmZmM4NmYzOGQ5NTI3ODZjNmQ2OTZjNzljMmRiYzIzOWRkNGU5MWI0NjcyOWQ3M2EyN2ZiNTdlOQ==')
  check('invoiceHash set (base64 44 chars)', typeof issue.json.invoiceHash === 'string' && String(issue.json.invoiceHash).length === 44)
  check('issuedAt set', typeof issue.json.issuedAt === 'string')
  check('qrPayload present', typeof issue.json.qrPayload === 'string')
  const tags = tlvDecode(String(issue.json.qrPayload))
  check('QR decodes to 5 TLV tags', tags.length === 5, `got ${tags.length}`)
  check('tag1 seller name (Arabic)', tags[0]?.tag === 1 && /[\u0600-\u06FF]/.test(tags[0]?.value ?? ''), JSON.stringify(tags[0]))
  check('tag3 timestamp ISO', tags[2]?.tag === 3 && String(tags[2]?.value).includes('T'), JSON.stringify(tags[2]))
  check('tag4 total 4670.00', tags[3]?.value === '4670.00', `got ${tags[3]?.value}`)
  check('tag5 vat 570.00', tags[4]?.value === '570.00', `got ${tags[4]?.value}`)
  check('qrDataUrl PNG', String(issue.json.qrDataUrl).startsWith('data:image/png;base64,'))

  // QR route for a draft later; also verify qr route on issued
  const qrIssued = await api('GET', `/api/e-invoices/${invId}/qr`)
  check('qr route 200', qrIssued.status === 200 && typeof qrIssued.json.qrPayload === 'string')

  // 6 ─ edit/delete after issue → locked
  console.log('— 6. locked after issue —')
  const editLocked = await api('PUT', `/api/e-invoices/${invId}`, createBody)
  check('PUT after issue → 400', editLocked.status === 400, `got ${editLocked.status}`)
  check('locked message', String(editLocked.json.error).includes('locked'))
  const delLocked = await api('DELETE', `/api/e-invoices/${invId}`)
  check('DELETE after issue → 400', delLocked.status === 400, `got ${delLocked.status}`)

  // 7 ─ payments
  console.log('— 7. payments —')
  const pay1 = await api('POST', `/api/e-invoices/${invId}/payments`, {
    amount: 2000,
    paymentDate: '2026-06-20',
    methodEn: 'Bank Transfer',
    reference: 'TRX-001',
  })
  check('payment 1 → 201', pay1.status === 201, `got ${pay1.status} ${JSON.stringify(pay1.json)}`)
  check('paidAmount 2000', pay1.json.paidAmount === 2000, `got ${pay1.json.paidAmount}`)
  check('status partially_paid', pay1.json.status === 'partially_paid')
  const payment1Id = String((pay1.json.payment as Record<string, unknown>)?.id ?? '')
  const pay2 = await api('POST', `/api/e-invoices/${invId}/payments`, {
    amount: 2670,
    paymentDate: '2026-06-25',
    methodEn: 'Cash',
  })
  check('payment 2 → 201', pay2.status === 201)
  check('paidAmount 4670 (paid)', pay2.json.paidAmount === 4670, `got ${pay2.json.paidAmount}`)
  check('status paid', pay2.json.status === 'paid')
  const payDel = await api('DELETE', `/api/e-invoices/${invId}/payments/${payment1Id}`)
  check('payment DELETE 200', payDel.status === 200, `got ${payDel.status}`)
  check('back to partially_paid (2670 of 4670)', payDel.json.status === 'partially_paid' && payDel.json.paidAmount === 2670, JSON.stringify(payDel.json))

  // overdue derivation: new draft with PAST due date → issue → overdue filter
  const overdueBody = {
    clientNameEn: 'E2E Overdue Client',
    issueDate: '2025-01-10',
    dueDate: '2025-02-01',
    items: [{ descriptionEn: 'Old works', quantity: 1, unitPrice: 500, vatPercent: 15 }],
  }
  const overdueCreate = await api('POST', '/api/e-invoices', overdueBody)
  check('overdue draft created', overdueCreate.status === 201)
  const overdueIssue = await api('POST', `/api/e-invoices/${String(overdueCreate.json.id)}/issue`)
  check('overdue issued (icv 2)', overdueIssue.status === 200 && overdueIssue.json.icv === 2, `icv=${overdueIssue.json.icv}`)
  const overdueList = await api('GET', '/api/e-invoices?status=overdue')
  const overdueRows = (overdueList.json.rows as Record<string, unknown>[]) ?? []
  check('?status=overdue finds it', overdueRows.some((r) => r.id === overdueCreate.json.id))
  check('overdue flag derived', overdueRows.find((r) => r.id === overdueCreate.json.id)?.overdue === true)
  check('totals.overdueCount ≥ 1', (overdueList.json.totals as Record<string, number>).overdueCount >= 1)

  // 8 ─ duplicate
  console.log('— 8. duplicate —')
  const dup = await api('POST', `/api/e-invoices/${invId}/duplicate`)
  check('duplicate 201', dup.status === 201, `got ${dup.status}`)
  check('new draft copy INV-2026-00002', dup.json.invoiceNumber === 'INV-2026-00002' && dup.json.status === 'draft', `got ${dup.json.invoiceNumber}`)
  const dupItems = (dup.json.items as unknown[]) ?? []
  check('items copied', dupItems.length === 2)
  check('payments NOT copied', ((dup.json.payments as unknown[]) ?? []).length === 0)
  check('issue data NOT copied', dup.json.uuid === null && dup.json.icv === null && dup.json.signedCopyImage === null)

  // 9 ─ credit note chain
  console.log('— 9. credit note + PIH chain —')
  const cn = await api('POST', '/api/e-invoices', {
    docType: 'credit_note',
    relatedInvoiceId: invId,
    clientNameEn: 'E2E Contracting Co',
    issueDate: '2026-06-30',
    items: [{ descriptionEn: 'Correction — returned 1 electrician', quantity: 1, unitPrice: 400, vatPercent: 15 }],
  })
  check('credit note 201', cn.status === 201, `got ${cn.status} ${JSON.stringify(cn.json)}`)
  check('number CRN-2026-00001', cn.json.invoiceNumber === 'CRN-2026-00001', `got ${cn.json.invoiceNumber}`)
  check('relatedInvoiceNumber INV-2026-00001', cn.json.relatedInvoiceNumber === 'INV-2026-00001')
  const cnIssue = await api('POST', `/api/e-invoices/${String(cn.json.id)}/issue`)
  check('credit note issued (icv 3)', cnIssue.status === 200 && cnIssue.json.icv === 3, `icv=${cnIssue.json.icv}`)
  check('previousHash chains to last issued hash', cnIssue.json.previousHash === overdueIssue.json.invoiceHash, `got ${cnIssue.json.previousHash}`)

  // 10 ─ signed copy on issued invoice
  console.log('— 10. signed copy —')
  const sc = await api('PUT', `/api/e-invoices/${invId}/signed-copy`, { image: TINY_PNG })
  check('signed-copy PUT 200 on issued invoice', sc.status === 200, `got ${sc.status} ${JSON.stringify(sc.json)}`)
  const scDetail = await api('GET', `/api/e-invoices/${invId}`)
  check('signed copy stored', scDetail.json.signedCopyImage === TINY_PNG)
  const scBad = await api('PUT', `/api/e-invoices/${invId}/signed-copy`, { image: 'data:image/png;base64,AAAA' })
  check('invalid image → 400', scBad.status === 400)
  const scDel = await api('DELETE', `/api/e-invoices/${invId}/signed-copy`)
  check('signed-copy DELETE 200', scDel.status === 200)

  // 11 ─ config
  console.log('— 11. e-invoice config —')
  const cfg0 = await api('GET', '/api/e-invoice-config')
  check('config GET defaults', cfg0.status === 200 && cfg0.json.topMm === 35 && cfg0.json.bottomMm === 22 && cfg0.json.showReceiverSignature === true && cfg0.json.translateProvider === 'builtin', JSON.stringify(cfg0.json))
  const cfgPut = await api('PUT', '/api/e-invoice-config', {
    topMm: 36,
    bottomMm: 23,
    showReceiverSignature: false,
    translateProvider: 'google',
    translateApiKey: 'test-key-123',
    letterhead: TINY_PNG,
  })
  check('config PUT 200', cfgPut.status === 200, `got ${cfgPut.status} ${JSON.stringify(cfgPut.json)}`)
  check('config reflected', cfgPut.json.topMm === 36 && cfgPut.json.bottomMm === 23 && cfgPut.json.showReceiverSignature === false && cfgPut.json.translateProvider === 'google' && cfgPut.json.translateApiKeySet === true, JSON.stringify(cfgPut.json))
  check('api key NEVER returned', !JSON.stringify(cfgPut.json).includes('test-key-123'))
  const cfgRestore = await api('PUT', '/api/e-invoice-config', {
    topMm: 35,
    bottomMm: 22,
    showReceiverSignature: true,
    translateProvider: 'builtin',
    translateApiKey: null,
    letterhead: null,
  })
  check('config restored', cfgRestore.status === 200 && cfgRestore.json.topMm === 35 && cfgRestore.json.bottomMm === 22 && cfgRestore.json.showReceiverSignature === true && cfgRestore.json.translateProvider === 'builtin' && cfgRestore.json.translateApiKeySet === false && cfgRestore.json.letterhead === '', JSON.stringify(cfgRestore.json))

  // 12 ─ next-number endpoint
  console.log('— 12. next-number —')
  const nn1 = await api('GET', '/api/e-invoices/next-number?docType=invoice')
  check('next invoice INV-2026-00003', nn1.status === 200 && nn1.json.nextNumber === 'INV-2026-00003', `got ${JSON.stringify(nn1.json)}`)
  const nn2 = await api('GET', '/api/e-invoices/next-number?docType=credit_note')
  check('next credit note CRN-2026-00002', nn2.json.nextNumber === 'CRN-2026-00002', `got ${JSON.stringify(nn2.json)}`)
  const nn3 = await api('GET', '/api/e-invoices/next-number?docType=debit_note')
  check('next debit note DBN-2026-00001', nn3.json.nextNumber === 'DBN-2026-00001', `got ${JSON.stringify(nn3.json)}`)

  // extra: draft payment rejection + draft QR + glossary list/update/delete
  console.log('— extra checks —')
  const draftCreate = await api('POST', '/api/e-invoices', {
    clientNameEn: 'E2E Draft Pay Test',
    issueDate: '2026-06-15',
    items: [{ descriptionEn: 'Draft item', quantity: 1, unitPrice: 100, vatPercent: 15 }],
  })
  const draftPay2 = await api('POST', `/api/e-invoices/${String(draftCreate.json.id)}/payments`, { amount: 50, paymentDate: '2026-06-16' })
  check('payment on draft → 400 "Issue the invoice first"', draftPay2.status === 400 && String(draftPay2.json.error).includes('Issue the invoice first'), `got ${draftPay2.status} ${JSON.stringify(draftPay2.json)}`)
  const draftQr = await api('GET', `/api/e-invoices/${String(draftCreate.json.id)}/qr`)
  check('draft QR works (uses issueDate)', draftQr.status === 200 && typeof draftQr.json.qrPayload === 'string')
  const draftTags = tlvDecode(String(draftQr.json.qrPayload))
  check('draft QR tag4 = 115.00', draftTags[3]?.value === '115.00', `got ${draftTags[3]?.value}`)

  const gList = await api('GET', '/api/glossary')
  check('glossary GET lists term', gList.status === 200 && Array.isArray(gList.json.data) && (gList.json.data as unknown[]).some((t) => (t as Record<string, string>).termEn === 'Manpower Supply'))
  const gDup = await api('POST', '/api/glossary', { termEn: 'Manpower Supply', termAr: 'x' })
  check('glossary duplicate → 409', gDup.status === 409)
  const gUpd = await api('PUT', `/api/glossary/${glossaryId}`, { termAr: 'توريد العمالة المحدثة' })
  check('glossary PUT 200', gUpd.status === 200 && gUpd.json.termAr === 'توريد العمالة المحدثة')

  // list filters
  const searchList = await api('GET', '/api/e-invoices?search=E2E Contracting')
  check('search finds by client', ((searchList.json.rows as unknown[]) ?? []).length >= 2)
  const yearList = await api('GET', '/api/e-invoices?year=2026')
  check('year filter works', ((yearList.json.rows as unknown[]) ?? []).length >= 3)
  check('years array includes 2026 & 2025', (yearList.json.years as number[]).includes(2026) && (yearList.json.years as number[]).includes(2025))
  const clientFilter = await api('GET', '/api/e-invoices?status=paid')
  check('status=paid filter', ((clientFilter.json.rows as unknown[]) ?? []).length === 0) // none paid right now

  // CLEANUP ─ delete ALL test e-invoices + glossary terms; restore config
  console.log('— cleanup —')
  const all = await api('GET', '/api/e-invoices?pageSize=100')
  const allRows = (all.json.rows as Record<string, unknown>[]) ?? []
  let delOk = 0
  let delFail = 0
  for (const r of allRows) {
    // issued ones cannot be deleted via API — clean via direct DB later if needed
    const d = await api('DELETE', `/api/e-invoices/${String(r.id)}`)
    if (d.status === 200) delOk++
    else delFail++
  }
  console.log(`    API-deleted ${delOk} drafts, ${delFail} locked (issued) need direct DB cleanup`)
  const gDel = await api('DELETE', `/api/glossary/${glossaryId}`)
  check('glossary term deleted', gDel.status === 200)

  console.log(`\n=== ${passed} passed, ${failed} failed ===`)
  if (failures.length) {
    console.log('FAILURES:')
    for (const f of failures) console.log(`  - ${f}`)
  }
  process.exit(failed > 0 ? 1 : 0)
}

main().catch((err) => {
  console.error('E2E crashed:', err)
  process.exit(1)
})

export {}
