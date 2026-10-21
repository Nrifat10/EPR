// POST /api/zatca/test-connection — verify the Phase 2 gateway configuration.
//   • simulation env → LOCAL validation only (VAT number, EGS serial format,
//     EC keypair) — no network call is made.
//   • preprod/production env → a real GET to the gateway's /invoices/pid
//     endpoint with the CSID bearer token (8s timeout). A network failure is
//     EXPECTED in an offline sandbox and is reported clearly (ok:false with
//     the error), never thrown.
// The outcome is persisted as the zatca_last_test Setting row either way.
import {
  ok,
  serverError,
  requirePermission,
  isResponse,
} from '@/lib/api-helpers'
import {
  readZatcaProfile,
  readZatcaCsidToken,
  readSellerInfo,
  hasZatcaKeys,
  saveZatcaLastTest,
  type ZatcaLastTest,
} from '@/lib/zatca'

export const dynamic = 'force-dynamic'

/** ZATCA EGS serial format: "N-value" segments joined by '|', e.g. 1-landmarkintergulf|2-SRV|3-001 */
const EGS_SERIAL_RE = /^\d+-[^|]+(\|\d+-[^|]+)+$/

type LocalCheck = { name: string; ok: boolean; detail: string }

export async function POST() {
  try {
    const auth = await requirePermission('einvoices.view')
    if (isResponse(auth)) return auth

    const startedAt = Date.now()
    const profile = await readZatcaProfile()
    const checks: LocalCheck[] = []

    // Local sanity checks — always useful context, included in every result
    const seller = await readSellerInfo()
    const vatOk = /^\d{15}$/.test(seller.vatNumber)
    checks.push({
      name: 'Seller VAT number',
      ok: vatOk,
      detail: vatOk
        ? `VAT ${seller.vatNumber} (15 digits) is set`
        : 'Seller VAT number is missing or not 15 digits — set it under Settings → Company & Tax',
    })

    const egsOk = EGS_SERIAL_RE.test(profile.egsSerial)
    checks.push({
      name: 'EGS unit serial',
      ok: egsOk,
      detail: egsOk
        ? `EGS serial ${profile.egsSerial} has the required N-value|N-value format`
        : 'EGS serial is missing or malformed — expected e.g. 1-landmarkintergulf|2-SRV|3-001',
    })

    const keysOk = await hasZatcaKeys()
    checks.push({
      name: 'ECDSA keypair',
      ok: keysOk,
      detail: keysOk
        ? 'EC P-256 keypair is present (QR tags 7-8 / UBL signature)'
        : 'No ZATCA keypair yet — it is generated automatically when the first Phase 2 invoice is stamped',
    })

    // ---- simulation: local validation only, no gateway call ----
    if (profile.env === 'simulation') {
      const latencyMs = Date.now() - startedAt
      const result = {
        ok: checks.every((c) => c.ok),
        mode: 'simulation' as const,
        checks,
        latencyMs,
        note: 'Simulation mode validates the configuration locally without calling the ZATCA gateway.',
      }
      const lastTest: ZatcaLastTest = {
        at: new Date().toISOString(),
        ok: result.ok,
        mode: profile.env,
        error: result.ok ? undefined : 'Local validation failed — see checks',
        latencyMs,
      }
      await saveZatcaLastTest(lastTest)
      return ok(result)
    }

    // ---- preprod / production: probe the real gateway ----
    const token = await readZatcaCsidToken()
    let httpStatus: number | undefined
    let errorMessage: string | undefined
    let reachable = false

    try {
      const res = await fetch(`${profile.apiBase.replace(/\/$/, '')}/invoices/pid`, {
        method: 'GET',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        signal: AbortSignal.timeout(8000),
        cache: 'no-store',
      })
      httpStatus = res.status
      reachable = true
      if (!res.ok) {
        errorMessage = `Gateway responded with HTTP ${res.status} — ${
          token ? 'the CSID token may be invalid or expired' : 'no CSID token is configured'
        }`
      }
    } catch (err) {
      // Offline sandbox / DNS failure / timeout — expected, report clearly
      errorMessage = `Gateway unreachable (${
        err instanceof Error ? err.message : 'network error'
      }) — check internet connectivity or use simulation mode`
    }

    const latencyMs = Date.now() - startedAt
    const result = {
      ok: reachable && (httpStatus ?? 500) < 400 && checks.every((c) => c.ok),
      mode: profile.env,
      checks,
      httpStatus,
      error: errorMessage,
      latencyMs,
    }
    const lastTest: ZatcaLastTest = {
      at: new Date().toISOString(),
      ok: result.ok,
      mode: profile.env,
      httpStatus,
      error: errorMessage,
      latencyMs,
    }
    await saveZatcaLastTest(lastTest)
    return ok(result)
  } catch {
    return serverError()
  }
}
