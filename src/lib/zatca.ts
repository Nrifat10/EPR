// ─────────────────────────────────────────────────────────────────────────────
// ZATCA e-Invoicing library (server-side only) — shared infrastructure for
// the E-Invoice module (the classic Invoice module was retired; the E-Invoice
// module builds its own UBL XML / QR stamps in lib/e-invoice.ts on top of
// these primitives + the connection profile below).
//
// Contains:
//   • TLV encoder (QR payload building blocks)
//   • Seller info + Fatoora connection profile (env / EGS serial / CSID
//     token / last test) persisted in the Setting table
//   • EC P-256 keypair management (auto-generated once) + ECDSA signing
//     helpers used for the Phase 2 cryptographic stamp
//
// Phase semantics (EInvoice.zatcaPhase = 1 | 2 — chosen per document while
// draft, locked at issue):
//   PHASE 1 (Generation) — QR with TLV tags 1-5 only, no crypto, no portal.
//   PHASE 2 (Integration) — full 8-tag crypto stamp + UBL 2.1 XML + PIH
//     chain, submitted to the Fatoora gateway (reporting/clearance) using
//     the connection profile below.
//
// Key management: an EC P-256 keypair is generated on first use and stored
// in the Setting table (zatca_private_key / zatca_public_key PEM strings).
// Formal certification still requires onboarding on the Fatoora portal
// (CSID issuance) — this implementation produces the exact data structure
// the portal expects, so the onboarding step is a configuration concern,
// not a code change.
// ─────────────────────────────────────────────────────────────────────────────
import {
  createSign,
  generateKeyPairSync,
  createPrivateKey,
  createPublicKey,
} from 'node:crypto'
import { db } from '@/lib/db'

/** KSA-mandated initial PIH for the FIRST invoice of a chain (base64 of SHA-256 of "0"). */
export const ZATCA_INITIAL_PIH =
  'NWZlY2ViNjZmZmM4NmYzOGQ5NTI3ODZjNmQ2OTZjNzljMmRiYzIzOWRkNGU5MWI0NjcyOWQ3M2EyN2ZiNTdlOQ=='

// ── TLV encoding ────────────────────────────────────────────────────────────

/** [tag (1 byte)][length (2 bytes, big-endian)][UTF-8 value] → Buffer */
export function tlvEncode(entries: { tag: number; value: string }[]): Buffer {
  const parts: Buffer[] = []
  for (const { tag, value } of entries) {
    const valueBytes = Buffer.from(value, 'utf8')
    const head = Buffer.alloc(3)
    head.writeUInt8(tag & 0xff, 0)
    head.writeUInt16BE(valueBytes.length, 1)
    parts.push(head, valueBytes)
  }
  return Buffer.concat(parts)
}

// ── Settings access ─────────────────────────────────────────────────────────

export type ZatcaSellerInfo = {
  companyName: string
  companyNameAr: string
  address: string
  addressAr: string
  vatNumber: string
  crNumber: string
  currency: string
  bankName: string
  bankIban: string
}

/** Read the seller-related Setting rows (with the same defaults the API uses). */
export async function readSellerInfo(): Promise<ZatcaSellerInfo> {
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
  }
}

// ── ZATCA connection profile (Phase 2 gateway configuration) ────────────────

export type ZatcaEnv = 'simulation' | 'preprod' | 'production'

/** Default Fatoora gateway base URLs per environment. */
export const ZATCA_ENV_BASES: Record<ZatcaEnv, string> = {
  simulation: 'https://gw-fatura.zatca.gov.sa/e-invoicing/simulation',
  preprod: 'https://gw-fatura.zatca.gov.sa/e-invoicing/developer-portal',
  production: 'https://gw-fatura.zatca.gov.sa/e-invoicing/core',
}

/** Result of the last "Test Connection" run (persisted as zatca_last_test). */
export type ZatcaLastTest = {
  at: string // ISO timestamp
  ok: boolean
  mode: ZatcaEnv
  httpStatus?: number
  error?: string
  latencyMs: number
}

/**
 * The ZATCA connection profile returned to clients — NEVER includes the raw
 * CSID token, only whether one is configured (csidTokenSet).
 */
export type ZatcaProfile = {
  env: ZatcaEnv
  egsSerial: string
  csidTokenSet: boolean
  apiBase: string
  lastTest: ZatcaLastTest | null
}

function parseZatcaEnv(v: string | undefined): ZatcaEnv {
  return v === 'preprod' || v === 'production' ? v : 'simulation'
}

function parseLastTest(v: string | undefined): ZatcaLastTest | null {
  if (!v) return null
  try {
    const raw = JSON.parse(v) as Partial<ZatcaLastTest>
    if (!raw || typeof raw.at !== 'string' || typeof raw.ok !== 'boolean') return null
    return {
      at: raw.at,
      ok: raw.ok,
      mode: parseZatcaEnv(raw.mode),
      httpStatus: typeof raw.httpStatus === 'number' ? raw.httpStatus : undefined,
      error: typeof raw.error === 'string' ? raw.error : undefined,
      latencyMs: typeof raw.latencyMs === 'number' ? raw.latencyMs : 0,
    }
  } catch {
    return null // malformed JSON — treat as never tested
  }
}

/** Read the ZATCA gateway profile from the Setting table (token stays server-side). */
export async function readZatcaProfile(): Promise<ZatcaProfile> {
  const rows = await db.setting.findMany({
    where: {
      key: {
        in: ['zatca_env', 'zatca_egs_serial', 'zatca_csid_token', 'zatca_api_base', 'zatca_last_test'],
      },
    },
  })
  const map: Record<string, string> = {}
  for (const r of rows) map[r.key] = r.value

  const env = parseZatcaEnv(map.zatca_env)
  // An explicitly saved apiBase wins over the per-environment default
  const apiBase = (map.zatca_api_base ?? '').trim() || ZATCA_ENV_BASES[env]
  return {
    env,
    egsSerial: (map.zatca_egs_serial ?? '').trim(),
    csidTokenSet: Boolean((map.zatca_csid_token ?? '').trim()),
    apiBase,
    lastTest: parseLastTest(map.zatca_last_test),
  }
}

/** Read the raw CSID bearer token (server-side only — never send to a client). */
export async function readZatcaCsidToken(): Promise<string> {
  const row = await db.setting.findUnique({ where: { key: 'zatca_csid_token' } })
  return (row?.value ?? '').trim()
}

/** Upsert (value) or remove (null) one zatca_* Setting row. */
export async function writeZatcaSetting(key: string, value: string | null): Promise<void> {
  if (value === null) {
    await db.setting.deleteMany({ where: { key } })
    return
  }
  await db.setting.upsert({
    where: { key },
    update: { value },
    create: { key, value },
  })
}

/** Persist the outcome of a connection test (never throws). */
export async function saveZatcaLastTest(test: ZatcaLastTest): Promise<void> {
  await writeZatcaSetting('zatca_last_test', JSON.stringify(test))
}

// ── ECDSA keypair (auto-generated once, stored in Setting) ──────────────────

type ZatcaKeys = { privatePem: string; publicPem: string }

export async function getZatcaKeys(): Promise<ZatcaKeys> {
  const rows = await db.setting.findMany({
    where: { key: { in: ['zatca_private_key', 'zatca_public_key'] } },
  })
  const map: Record<string, string> = {}
  for (const r of rows) map[r.key] = r.value

  if (map.zatca_private_key && map.zatca_public_key) {
    return { privatePem: map.zatca_private_key, publicPem: map.zatca_public_key }
  }

  // First use — generate an EC P-256 keypair (the curve ZATCA mandates)
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
  const privatePem = privateKey.export({ type: 'sec1', format: 'pem' }).toString()
  const publicPem = publicKey.export({ type: 'spki', format: 'pem' }).toString()
  await db.$transaction([
    db.setting.upsert({
      where: { key: 'zatca_private_key' },
      update: { value: privatePem },
      create: { key: 'zatca_private_key', value: privatePem },
    }),
    db.setting.upsert({
      where: { key: 'zatca_public_key' },
      update: { value: publicPem },
      create: { key: 'zatca_public_key', value: publicPem },
    }),
  ])
  return { privatePem, publicPem }
}

/** Check whether the ZATCA EC keypair has been generated (no side effects). */
export async function hasZatcaKeys(): Promise<boolean> {
  const rows = await db.setting.findMany({
    where: { key: { in: ['zatca_private_key', 'zatca_public_key'] } },
    select: { key: true },
  })
  const found = new Set(rows.map((r) => r.key))
  return found.has('zatca_private_key') && found.has('zatca_public_key')
}

/**
 * QR tag 8 value: base64 of the RAW 64-byte EC point (x‖y), 0x04 prefix
 * stripped — exactly the form ZATCA specifies. Derived from the SPKI PEM.
 */
export function ecPublicKeyBase64(publicPem: string): string {
  const jwk = createPublicKey(publicPem).export({ format: 'jwk' }) as {
    x?: string
    y?: string
  }
  const x = Buffer.from(jwk.x ?? '', 'base64url')
  const y = Buffer.from(jwk.y ?? '', 'base64url')
  return Buffer.concat([x, y]).toString('base64')
}

/** Sign the invoice hash with ECDSA/SHA-256 → base64 (DER encoded, as node emits). */
export function signHash(privatePem: string, data: Buffer): string {
  const signer = createSign('SHA256')
  signer.update(data)
  return signer.sign(createPrivateKey(privatePem)).toString('base64')
}

