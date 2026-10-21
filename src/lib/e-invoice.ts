// ─────────────────────────────────────────────────────────────────────────────
// E-Invoice library (server-side only — imports the Prisma client).
// Bilingual (EN/AR) ZATCA-style tax invoices, credit notes and debit notes:
//   • number generation  INV-YYYY-00001 | CRN-YYYY-00001 | DBN-YYYY-00001
//   • per-line + header money math (server is the single source of truth)
//   • UBL 2.1-style XML (deterministic — hashes cover ALL invoice content)
//   • base64 SHA-256 invoice hash + PIH chain seed
//   • 5-tag TLV QR payload (Phase 1 style) rendered as a data-URL PNG
// Seller identity/bank details come from the Setting table (same source the
// quotations/invoices print views use).
// Frontend note: this module is SERVER-ONLY (db import) — client components
// must not import it; duplicate the tiny pure helpers client-side if needed.
// ─────────────────────────────────────────────────────────────────────────────
import { createHash } from 'node:crypto'
import type { Prisma, PrismaClient } from '@prisma/client'
import QRCode from 'qrcode'
import { db } from '@/lib/db'
import { round2 } from '@/lib/format'
import { tlvEncode, ZATCA_INITIAL_PIH, getZatcaKeys, signHash, ecPublicKeyBase64 } from '@/lib/zatca'

export { ZATCA_INITIAL_PIH }

// ── Document types & number generation ──────────────────────────────────────

export const DOC_PREFIX: Record<string, string> = {
  invoice: 'INV',
  credit_note: 'CRN',
  debit_note: 'DBN',
}

export type EInvoiceDocType = 'invoice' | 'credit_note' | 'debit_note'

/**
 * Next e-invoice number for a docType + issue year:
 * `{PREFIX}-{YYYY}-{00001}` — 5-digit sequence = max existing sequence for
 * that prefix+year + 1 (parsed from stored numbers LIKE 'PREFIX-YYYY-%').
 */
export async function nextEInvoiceNumber(
  docType: string,
  issueDate: Date,
  tx: Prisma.TransactionClient | PrismaClient = db
): Promise<string> {
  const prefix = DOC_PREFIX[docType] ?? DOC_PREFIX.invoice
  const year = issueDate.getFullYear()
  const stem = `${prefix}-${year}-`
  const existing = await tx.eInvoice.findMany({
    where: { invoiceNumber: { startsWith: stem } },
    select: { invoiceNumber: true },
  })
  let max = 0
  for (const row of existing) {
    const n = parseInt(row.invoiceNumber.slice(stem.length), 10)
    if (Number.isInteger(n) && n > max) max = n
  }
  return `${stem}${String(max + 1).padStart(5, '0')}`
}

// ── Money math (server-computed, never trusts client figures) ───────────────

export type EInvoiceItemInput = {
  quantity: number
  unitPrice: number
  discount?: number | null
  vatPercent?: number | null
}

export type EInvoiceItemTotals = {
  taxableAmount: number
  vatAmount: number
  lineTotal: number
}

/** taxable = round2(qty × price − discount); vat = round2(taxable × vat%/100). */
export function computeItemTotals(item: EInvoiceItemInput): EInvoiceItemTotals {
  const quantity = round2(item.quantity)
  const unitPrice = round2(item.unitPrice)
  const discount = round2(item.discount ?? 0)
  const vatPercent = round2(item.vatPercent ?? 15)
  const taxableAmount = round2(quantity * unitPrice - discount)
  const vatAmount = round2((taxableAmount * vatPercent) / 100)
  return { taxableAmount, vatAmount, lineTotal: round2(taxableAmount + vatAmount) }
}

export type EInvoiceTotals = {
  subtotal: number
  totalDiscount: number
  taxableAmount: number
  vatAmount: number
  totalDue: number
}

/** Header totals from normalized items (each with taxableAmount/vatAmount). */
export function computeInvoiceTotals(
  items: (EInvoiceItemInput & Partial<EInvoiceItemTotals>)[]
): EInvoiceTotals {
  let subtotal = 0
  let totalDiscount = 0
  let vatSum = 0
  for (const it of items) {
    subtotal = round2(subtotal + round2(round2(it.quantity) * round2(it.unitPrice)))
    totalDiscount = round2(totalDiscount + round2(it.discount ?? 0))
    vatSum = round2(vatSum + (it.vatAmount ?? computeItemTotals(it).vatAmount))
  }
  const taxableAmount = round2(subtotal - totalDiscount)
  return {
    subtotal,
    totalDiscount,
    taxableAmount,
    vatAmount: vatSum,
    totalDue: round2(taxableAmount + vatSum),
  }
}

// ── Seller info (Settings — same defaults as the print views) ───────────────

export type ESellerInfo = {
  companyName: string
  companyNameAr: string
  address: string
  addressAr: string
  vatNumber: string
  crNumber: string
  currency: string
  bankName: string
  bankIban: string
  bankAccountNumber: string
  bankAccountName: string
  bankSwiftCode: string
  bankAddress: string
}

/** Read seller + bank Setting rows (pattern of zatca.ts readSellerInfo, extended). */
export async function readEInvoiceSellerInfo(): Promise<ESellerInfo> {
  const rows = await db.setting.findMany()
  const map: Record<string, string> = {}
  for (const r of rows) map[r.key] = r.value
  return {
    companyName: map.companyName || 'Landmark Inter Gulf',
    companyNameAr: map.companyNameAr || 'لاندمارك انتر جلف',
    address: map.address || '',
    addressAr: map.addressAr || '',
    vatNumber: (map.vatNumber || '').trim(),
    crNumber: (map.crNumber || '').trim(),
    currency: map.currency || 'SAR',
    bankName: map.bankName || '',
    bankIban: map.bankIban || '',
    bankAccountNumber: map.bankAccountNumber || '',
    bankAccountName: map.bankAccountName || '',
    bankSwiftCode: map.bankSwiftCode || '',
    bankAddress: map.bankAddress || '',
  }
}

// ── UBL 2.1-style XML (deterministic, bilingual) ────────────────────────────

/** Structural type satisfied by Prisma EInvoice rows (and plain objects in tests). */
export type EXmlInvoice = {
  invoiceNumber: string
  uuid: string | null
  docType: string
  issueDate: Date
  supplyDate: Date | null
  dueDate: Date | null
  clientNameEn: string
  clientNameAr: string
  clientVatNumber: string | null
  clientCrNumber: string | null
  clientAddressEn: string | null
  clientAddressAr: string | null
  poRef: string | null
  contractRef: string | null
  subtotal: number
  totalDiscount: number
  taxableAmount: number
  vatAmount: number
  totalDue: number
}

export type EXmlItem = {
  sr: number
  descriptionEn: string
  descriptionAr: string
  unitEn: string | null
  quantity: number
  unitPrice: number
  discount: number
  vatPercent: number
  taxableAmount: number
  vatAmount: number
  lineTotal: number
}

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/**
 * UBL 2.1-style XML for the bilingual e-invoice. Root element follows the
 * docType (Invoice | CreditNote | DebitNote). RegistrationName carries the
 * English legal name; PartyName/Name carries the Arabic name. The document
 * is deterministic and covers ALL invoice content (number, uuid, dates,
 * parties EN+AR, VAT/CR numbers, every line with descriptionEn/Ar, qty,
 * price, discount, vat%, totals, previousHash, icv) so the SHA-256 hash is
 * a true content fingerprint.
 */
export function buildEInvoiceXml(
  inv: EXmlInvoice,
  items: EXmlItem[],
  seller: ESellerInfo,
  previousHash: string,
  icv: number
): string {
  const cur = xmlEscape(seller.currency)
  const date = inv.issueDate.toISOString().slice(0, 10)
  const time = inv.issueDate.toISOString().slice(11, 19) + 'Z'
  // 0100000 = standard (B2B) · 0200000 = simplified; notes reuse 0100000
  const typeCode = '0100000'
  const root =
    inv.docType === 'credit_note' ? 'CreditNote' : inv.docType === 'debit_note' ? 'DebitNote' : 'Invoice'

  const sellerArBlock = seller.companyNameAr
    ? `
      <cac:PartyName><cbc:Name>${xmlEscape(seller.companyNameAr)}</cbc:Name></cac:PartyName>`
    : ''
  const sellerAddrAr = seller.addressAr
    ? `
        <cbc:AdditionalStreetName>${xmlEscape(seller.addressAr)}</cbc:AdditionalStreetName>`
    : ''
  const buyerArBlock = inv.clientNameAr
    ? `
      <cac:PartyName><cbc:Name>${xmlEscape(inv.clientNameAr)}</cbc:Name></cac:PartyName>`
    : ''
  const buyerAddrAr = inv.clientAddressAr
    ? `
        <cbc:AdditionalStreetName>${xmlEscape(inv.clientAddressAr)}</cbc:AdditionalStreetName>`
    : ''

  const lines = items
    .map(
      (it) => `  <cac:InvoiceLine>
    <cbc:ID>${it.sr}</cbc:ID>${it.unitEn ? `
    <cbc:InvoicedQuantity unitCode="${xmlEscape(it.unitEn)}">${round2(it.quantity)}</cbc:InvoicedQuantity>` : `
    <cbc:InvoicedQuantity>${round2(it.quantity)}</cbc:InvoicedQuantity>`}
    <cbc:LineExtensionAmount currencyID="${cur}">${round2(it.taxableAmount).toFixed(2)}</cbc:LineExtensionAmount>${it.discount > 0 ? `
    <cac:AllowanceCharge>
      <cbc:ChargeIndicator>false</cbc:ChargeIndicator>
      <cbc:AllowanceChargeReason>Discount</cbc:AllowanceChargeReason>
      <cbc:Amount currencyID="${cur}">${round2(it.discount).toFixed(2)}</cbc:Amount>
    </cac:AllowanceCharge>` : ''}
    <cac:Item>
      <cbc:Name>${xmlEscape(it.descriptionEn)}</cbc:Name>${it.descriptionAr ? `
      <cac:ItemInstance><cbc:AdditionalItemProperty><cbc:Name>description_ar</cbc:Name><cbc:Value>${xmlEscape(it.descriptionAr)}</cbc:Value></cbc:AdditionalItemProperty></cac:ItemInstance>` : ''}
      <cac:ClassifiedTaxCategory>
        <cbc:ID>${it.vatPercent > 0 ? 'S' : 'Z'}</cbc:ID>
        <cbc:Percent>${round2(it.vatPercent).toFixed(2)}</cbc:Percent>
        <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>
      </cac:ClassifiedTaxCategory>
    </cac:Item>
    <cac:Price>
      <cbc:PriceAmount currencyID="${cur}">${round2(it.unitPrice).toFixed(2)}</cbc:PriceAmount>
    </cac:Price>
    <cac:TaxTotal>
      <cbc:TaxAmount currencyID="${cur}">${round2(it.vatAmount).toFixed(2)}</cbc:TaxAmount>
      <cac:TaxSubtotal>
        <cbc:TaxableAmount currencyID="${cur}">${round2(it.taxableAmount).toFixed(2)}</cbc:TaxableAmount>
        <cbc:TaxAmount currencyID="${cur}">${round2(it.vatAmount).toFixed(2)}</cbc:TaxAmount>
        <cac:TaxCategory>
          <cbc:ID>${it.vatPercent > 0 ? 'S' : 'Z'}</cbc:ID>
          <cbc:Percent>${round2(it.vatPercent).toFixed(2)}</cbc:Percent>
          <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>
        </cac:TaxCategory>
      </cac:TaxSubtotal>
    </cac:TaxTotal>
  </cac:InvoiceLine>`
    )
    .join('\n')

  // VAT subtotals grouped by rate (deterministic ordering)
  const rateGroups = new Map<number, { taxable: number; vat: number }>()
  for (const it of items) {
    const key = round2(it.vatPercent)
    const g = rateGroups.get(key) ?? { taxable: 0, vat: 0 }
    g.taxable = round2(g.taxable + it.taxableAmount)
    g.vat = round2(g.vat + it.vatAmount)
    rateGroups.set(key, g)
  }
  const subtotals = [...rateGroups.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(
      ([rate, g]) => `    <cac:TaxSubtotal>
      <cbc:TaxableAmount currencyID="${cur}">${round2(g.taxable).toFixed(2)}</cbc:TaxableAmount>
      <cbc:TaxAmount currencyID="${cur}">${round2(g.vat).toFixed(2)}</cbc:TaxAmount>
      <cac:TaxCategory>
        <cbc:ID>${rate > 0 ? 'S' : 'Z'}</cbc:ID>
        <cbc:Percent>${round2(rate).toFixed(2)}</cbc:Percent>
        <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>
      </cac:TaxCategory>
    </cac:TaxSubtotal>`
    )
    .join('\n')

  return `<?xml version="1.0" encoding="UTF-8"?>
<${root} xmlns="urn:oasis:names:specification:ubl:schema:xsd:${root}-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:ProfileID>reporting:1.0</cbc:ProfileID>
  <cbc:ID>${xmlEscape(inv.invoiceNumber)}</cbc:ID>
  <cbc:UUID>${xmlEscape(inv.uuid ?? '')}</cbc:UUID>
  <cbc:IssueDate>${date}</cbc:IssueDate>
  <cbc:IssueTime>${time}</cbc:IssueTime>${inv.supplyDate ? `
  <cbc:DeliveryDate>${inv.supplyDate.toISOString().slice(0, 10)}</cbc:DeliveryDate>` : ''}${inv.dueDate ? `
  <cbc:DueDate>${inv.dueDate.toISOString().slice(0, 10)}</cbc:DueDate>` : ''}
  <cbc:InvoiceTypeCode name="${typeCode}">${typeCode}</cbc:InvoiceTypeCode>
  <cbc:DocumentCurrencyCode>${cur}</cbc:DocumentCurrencyCode>
  <cac:AdditionalDocumentReference>
    <cbc:ID>ICV</cbc:ID>
    <cbc:UUID>${icv}</cbc:UUID>
  </cac:AdditionalDocumentReference>
  <cac:AdditionalDocumentReference>
    <cbc:ID>PIH</cbc:ID>
    <cac:Attachment>
      <cbc:EmbeddedDocumentBinaryObject mimeCode="text/plain">${previousHash}</cbc:EmbeddedDocumentBinaryObject>
    </cac:Attachment>
  </cac:AdditionalDocumentReference>${inv.poRef ? `
  <cac:AdditionalDocumentReference>
    <cbc:ID>PO_REF</cbc:ID>
    <cbc:UUID>${xmlEscape(inv.poRef)}</cbc:UUID>
  </cac:AdditionalDocumentReference>` : ''}${inv.contractRef ? `
  <cac:AdditionalDocumentReference>
    <cbc:ID>CONTRACT_REF</cbc:ID>
    <cbc:UUID>${xmlEscape(inv.contractRef)}</cbc:UUID>
  </cac:AdditionalDocumentReference>` : ''}
  <cac:AccountingSupplierParty>
    <cac:Party>${seller.crNumber ? `
      <cac:PartyIdentification><cbc:ID schemeID="CR">${xmlEscape(seller.crNumber)}</cbc:ID></cac:PartyIdentification>` : ''}${sellerArBlock}
      <cac:PostalAddress>
        <cbc:StreetName>${xmlEscape(seller.address)}</cbc:StreetName>${sellerAddrAr}
        <cac:Country><cbc:IdentificationCode>SA</cbc:IdentificationCode></cac:Country>
      </cac:PostalAddress>
      <cac:PartyTaxScheme>
        <cbc:CompanyID schemeID="VAT">${xmlEscape(seller.vatNumber)}</cbc:CompanyID>
        <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>
      </cac:PartyTaxScheme>
      <cac:PartyLegalEntity>
        <cbc:RegistrationName>${xmlEscape(seller.companyName)}</cbc:RegistrationName>
      </cac:PartyLegalEntity>
    </cac:Party>
  </cac:AccountingSupplierParty>
  <cac:AccountingCustomerParty>
    <cac:Party>${inv.clientCrNumber ? `
      <cac:PartyIdentification><cbc:ID schemeID="CR">${xmlEscape(inv.clientCrNumber)}</cbc:ID></cac:PartyIdentification>` : ''}${buyerArBlock}${inv.clientVatNumber ? `
      <cac:PartyTaxScheme>
        <cbc:CompanyID schemeID="VAT">${xmlEscape(inv.clientVatNumber)}</cbc:CompanyID>
        <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>
      </cac:PartyTaxScheme>` : ''}
      <cac:PostalAddress>
        <cbc:StreetName>${xmlEscape(inv.clientAddressEn ?? '')}</cbc:StreetName>${buyerAddrAr}
        <cac:Country><cbc:IdentificationCode>SA</cbc:IdentificationCode></cac:Country>
      </cac:PostalAddress>
      <cac:PartyLegalEntity>
        <cbc:RegistrationName>${xmlEscape(inv.clientNameEn)}</cbc:RegistrationName>
      </cac:PartyLegalEntity>
    </cac:Party>
  </cac:AccountingCustomerParty>${seller.bankIban ? `
  <cac:PaymentMeans>
    <cbc:PaymentMeansCode>42</cbc:PaymentMeansCode>
    <cac:PayeeFinancialAccount><cbc:ID>${xmlEscape(seller.bankIban)}</cbc:ID></cac:PayeeFinancialAccount>
  </cac:PaymentMeans>` : ''}
  <cac:TaxTotal>
    <cbc:TaxAmount currencyID="${cur}">${round2(inv.vatAmount).toFixed(2)}</cbc:TaxAmount>
${subtotals}
  </cac:TaxTotal>
  <cac:LegalMonetaryTotal>
    <cbc:LineExtensionAmount currencyID="${cur}">${round2(inv.subtotal).toFixed(2)}</cbc:LineExtensionAmount>
    <cbc:AllowanceTotalAmount currencyID="${cur}">${round2(inv.totalDiscount).toFixed(2)}</cbc:AllowanceTotalAmount>
    <cbc:TaxExclusiveAmount currencyID="${cur}">${round2(inv.taxableAmount).toFixed(2)}</cbc:TaxExclusiveAmount>
    <cbc:TaxInclusiveAmount currencyID="${cur}">${round2(inv.totalDue).toFixed(2)}</cbc:TaxInclusiveAmount>
    <cbc:PayableAmount currencyID="${cur}">${round2(inv.totalDue).toFixed(2)}</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>
${lines}
</${root}>`
}

/** ZATCA-style invoice hash: base64 of the SHA-256 digest of the XML (UTF-8). */
export function hashEInvoiceXml(xml: string): string {
  return createHash('sha256').update(xml, 'utf8').digest('base64')
}

// ── QR payload (phase-aware TLV) ────────────────────────────────────────────

/** Structural type satisfied by Prisma EInvoice rows. */
export type EQRInvoice = {
  zatcaPhase?: number | null
  issuedAt: Date | null
  issueDate: Date
  totalDue: number
  vatAmount: number
}

/** Phase 2 stamp fields appended to the QR (tags 6-8) when available. */
export type EZatcaStampFields = {
  invoiceHash: string
  signature: string
  publicKeyBase64: string
}

/**
 * Phase-aware QR payload (base64 TLV):
 *   PHASE 1 (Generation) — the 5 mandatory tags only, no crypto:
 *     1 seller name (Arabic preferred) · 2 seller VAT number
 *     3 ISO-8601 timestamp (issuedAt if set else issueDate)
 *     4 invoice total (VAT inclusive) · 5 VAT total
 *   PHASE 2 (Integration) — same 5 tags PLUS the cryptographic stamp:
 *     6 invoice hash (base64 SHA-256 of the UBL XML) · 7 ECDSA signature
 *     8 ECDSA public key (raw 64-byte x‖y point)
 */
export function buildEInvoiceQrPayload(
  seller: ESellerInfo,
  invoice: EQRInvoice,
  stamp?: EZatcaStampFields | null
): string {
  const entries = [
    {
      tag: 1,
      value: seller.companyNameAr.trim() ? seller.companyNameAr : seller.companyName,
    },
    { tag: 2, value: seller.vatNumber },
    {
      tag: 3,
      value: (invoice.issuedAt ?? invoice.issueDate).toISOString(),
    },
    { tag: 4, value: round2(invoice.totalDue).toFixed(2) },
    { tag: 5, value: round2(invoice.vatAmount).toFixed(2) },
  ]
  // Phase 2 + complete stamp → extend to the full 8-tag cryptographic QR
  if (
    (invoice.zatcaPhase ?? 1) === 2 &&
    stamp &&
    stamp.invoiceHash &&
    stamp.signature &&
    stamp.publicKeyBase64
  ) {
    entries.push(
      { tag: 6, value: stamp.invoiceHash },
      { tag: 7, value: stamp.signature },
      { tag: 8, value: stamp.publicKeyBase64 }
    )
  }
  return tlvEncode(entries).toString('base64')
}

/** Render a QR payload as a PNG data URL (pure black on white, quiet zone 4). */
export async function qrDataUrl(payload: string): Promise<string> {
  return QRCode.toDataURL(payload, {
    margin: 4,
    width: 600,
    errorCorrectionLevel: 'M',
    color: { dark: '#000000', light: '#FFFFFF' },
  })
}

// ── Derived status helpers ──────────────────────────────────────────────────

/** Overdue is DERIVED, never stored: past due + open + underpaid. */
export function isEInvoiceOverdue(inv: {
  dueDate: Date | null
  status: string
  paidAmount: number
  totalDue: number
  now?: Date
}): boolean {
  if (!inv.dueDate) return false
  if (inv.status !== 'issued' && inv.status !== 'partially_paid') return false
  if (inv.paidAmount >= inv.totalDue - 0.005) return false
  const now = inv.now ?? new Date()
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  return inv.dueDate < todayStart
}

// ── Phase 2 submission bundle (UBL XML + cryptographic stamp) ───────────────

export type EInvoiceSubmission = {
  /** UBL 2.1 XML whose SHA-256 hash equals invoiceHash */
  xml: string
  invoiceHash: string
  /** base64 ECDSA signature of the invoice hash */
  signature: string
  /** base64 raw 64-byte EC public key (QR tag 8) */
  publicKeyBase64: string
  uuid: string
  icv: number
  /** True when the stored stamp no longer matched the rebuilt XML and was re-signed */
  restamped: boolean
}

/** Prisma row shape required to (re)build a Phase 2 submission. */
export type ESubmissionInvoice = Prisma.EInvoiceGetPayload<{ include: { items: true } }>

/**
 * Build everything needed to submit one PHASE 2 e-invoice to the Fatoora
 * gateway: the UBL 2.1 XML document plus its cryptographic stamp. The XML is
 * rebuilt deterministically from the stored row (uuid / icv / previousHash
 * embedded, so it hashes identically); if the current document no longer
 * hashes to the stored stamp (e.g. company details changed in Settings after
 * issuing), the stamp is re-signed and PERSISTED so the printed QR, the
 * stored fields and the submitted XML always agree.
 */
export async function buildEInvoiceSubmission(
  inv: ESubmissionInvoice,
  sellerOverride?: ESellerInfo
): Promise<EInvoiceSubmission> {
  if ((inv.zatcaPhase ?? 1) !== 2) {
    throw new Error('ZATCA submission requires a Phase 2 e-invoice')
  }
  const seller = sellerOverride ?? (await readEInvoiceSellerInfo())
  const items = [...inv.items].sort((a, b) => a.sr - b.sr)
  const totals = computeInvoiceTotals(items)
  const uuid = inv.uuid ?? ''
  const icv = inv.icv ?? 1
  const previousHash = inv.previousHash ?? ZATCA_INITIAL_PIH

  const xml = buildEInvoiceXml({ ...inv, ...totals, uuid }, items, seller, previousHash, icv)
  const invoiceHash = hashEInvoiceXml(xml)

  // Stored stamp still valid → reuse it byte-for-byte
  if (inv.invoiceHash === invoiceHash && inv.signature) {
    const keys = await getZatcaKeys()
    return {
      xml,
      invoiceHash,
      signature: inv.signature,
      publicKeyBase64: ecPublicKeyBase64(keys.publicPem),
      uuid,
      icv,
      restamped: false,
    }
  }

  // Stamp drifted (or was never signed) → re-sign + persist
  const keys = await getZatcaKeys()
  const signature = signHash(keys.privatePem, Buffer.from(invoiceHash, 'base64'))
  await db.eInvoice.update({
    where: { id: inv.id },
    data: { invoiceHash, signature },
  })
  return {
    xml,
    invoiceHash,
    signature,
    publicKeyBase64: ecPublicKeyBase64(keys.publicPem),
    uuid,
    icv,
    restamped: true,
  }
}
