// Image data-URL validation — used by the letterhead / signature / stamp
// upload APIs and by client-side helpers so both layers agree on the rules:
//   • PNG or JPEG only (checked by magic bytes, not just the mime label)
//   • decoded payload ≤ 2 MB
//   • must be a well-formed base64 data URL
// Server-safe (no DOM APIs) and client-safe (no node imports).

export const MAX_IMAGE_BYTES = 2 * 1024 * 1024 // 2 MB

export type ValidatedImage = {
  dataUrl: string
  mime: 'image/png' | 'image/jpeg'
  sizeBytes: number
}

const DATA_URL_RE = /^data:(image\/png|image\/jpeg|image\/jpg);base64,([A-Za-z0-9+/]+={0,2})$/

/** Decode a base64 payload and sniff the real format from its magic bytes. */
function sniffMime(bytes: Uint8Array): 'image/png' | 'image/jpeg' | null {
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
    bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a
  ) {
    return 'image/png'
  }
  // JPEG: FF D8 FF
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg'
  }
  return null
}

function base64ToBytes(b64: string): Uint8Array | null {
  try {
    const bin =
      typeof atob === 'function'
        ? atob(b64)
        : Buffer.from(b64, 'base64').toString('binary')
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    return bytes
  } catch {
    return null
  }
}

/**
 * Validate an uploaded image data URL. Returns null (with a reason via the
 * optional callback style of callers) when the image is rejected.
 */
export function validateImageDataUrl(value: unknown): ValidatedImage | null {
  if (typeof value !== 'string' || value.length === 0) return null
  const m = DATA_URL_RE.exec(value)
  if (!m) return null
  const declaredMime = m[1] === 'image/jpg' ? 'image/jpeg' : (m[1] as 'image/png' | 'image/jpeg')
  const bytes = base64ToBytes(m[2])
  if (!bytes || bytes.length === 0) return null
  if (bytes.length > MAX_IMAGE_BYTES) return null
  const sniffed = sniffMime(bytes)
  if (!sniffed || sniffed !== declaredMime) return null
  return { dataUrl: value, mime: sniffed, sizeBytes: bytes.length }
}

/** Human-readable file size for UI hints. */
export function formatImageSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${Math.max(1, Math.round(bytes / 1024))} KB`
}

/**
 * Read a File/Blob as a data URL (browser only). Rejects oversized files
 * before reading so huge uploads never enter memory twice.
 */
export function fileToDataUrl(file: File, maxBytes = MAX_IMAGE_BYTES): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!/^image\/(png|jpe?g)$/.test(file.type)) {
      reject(new Error('Only PNG or JPEG images are allowed'))
      return
    }
    if (file.size > maxBytes) {
      reject(new Error(`Image is too large — maximum ${formatImageSize(maxBytes)}`))
      return
    }
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('Could not read the image file'))
    reader.onload = () => {
      if (typeof reader.result === 'string') resolve(reader.result)
      else reject(new Error('Could not read the image file'))
    }
    reader.readAsDataURL(file)
  })
}
