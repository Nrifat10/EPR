// Server-only AES-256-GCM encryption for AI provider API keys.
// The key is derived (scrypt) from a server secret; ciphertext never leaves
// the server — the settings API only returns a masked hint.
import 'server-only'
import { createCipheriv, createDecipheriv, randomBytes, scrypt as _scrypt } from 'crypto'
import { promisify } from 'util'

const scrypt = promisify(_scrypt) as (
  password: string,
  salt: string,
  keylen: number
) => Promise<Buffer>

// Per-install random secret persisted in the Setting table on first use.
// (Kept out of source control; rotating it invalidates stored keys, which the
// admin can simply re-enter.)
const SECRET_KEY = 'aiCryptoSecret'
const ALGO = 'aes-256-gcm'

async function getMasterKey(): Promise<Buffer> {
  const { db } = await import('@/lib/db')
  let row = await db.setting.findUnique({ where: { key: SECRET_KEY } })
  if (!row) {
    await db.setting.upsert({
      where: { key: SECRET_KEY },
      update: {},
      create: { key: SECRET_KEY, value: randomBytes(32).toString('hex') },
    })
    row = await db.setting.findUnique({ where: { key: SECRET_KEY } })
  }
  const secret = row?.value ?? 'landmark-ai-fallback-secret'
  // Derive a stable 32-byte key from the secret
  return scrypt(secret, 'landmark-ai-key-salt', 32)
}

/** Encrypt a plaintext API key → "v1:<iv hex>:<tag hex>:<ciphertext hex>" */
export async function encryptSecret(plain: string): Promise<string> {
  const key = await getMasterKey()
  const iv = randomBytes(12)
  const cipher = createCipheriv(ALGO, key, iv)
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `v1:${iv.toString('hex')}:${tag.toString('hex')}:${enc.toString('hex')}`
}

/** Decrypt a ciphertext produced by encryptSecret. Returns null when invalid. */
export async function decryptSecret(packed: string | null | undefined): Promise<string | null> {
  if (!packed) return null
  try {
    const [v, ivHex, tagHex, dataHex] = packed.split(':')
    if (v !== 'v1' || !ivHex || !tagHex || !dataHex) return null
    const key = await getMasterKey()
    const decipher = createDecipheriv(ALGO, key, Buffer.from(ivHex, 'hex'))
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'))
    const dec = Buffer.concat([
      decipher.update(Buffer.from(dataHex, 'hex')),
      decipher.final(),
    ])
    return dec.toString('utf8')
  } catch {
    return null
  }
}

/** Masked hint for the UI: "sk-pro…9f2a" (never the full key). */
export function maskKey(plain: string | null | undefined): string | null {
  if (!plain) return null
  if (plain.length <= 8) return '••••'
  return `${plain.slice(0, 6)}…${plain.slice(-4)}`
}
