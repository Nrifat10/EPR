// Client-side API wrapper for all fetch calls

// Session token fallback for iframe contexts (sandbox preview panel), where
// browsers block SameSite=Lax cookies. After login the token is stored here
// and attached to every request as `Authorization: Bearer <token>`.
// In first-party contexts the httpOnly cookie still does the primary work —
// the header is simply ignored server-side when the cookie already resolves.
const TOKEN_KEY = 'lig_session_token'

export function setAuthToken(token: string | null | undefined): void {
  try {
    if (token) window.localStorage.setItem(TOKEN_KEY, token)
    else window.localStorage.removeItem(TOKEN_KEY)
  } catch {
    // localStorage unavailable (private mode etc.) — cookie path still works
  }
}

export function getAuthToken(): string | null {
  try {
    return window.localStorage.getItem(TOKEN_KEY)
  } catch {
    return null
  }
}

export class ApiError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
    this.name = 'ApiError'
  }
}

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const token = getAuthToken()
  const isForm = options?.body instanceof FormData
  const res = await fetch(url, {
    ...options,
    headers: {
      // FormData bodies must NOT carry a JSON content-type — the browser sets
      // the multipart boundary itself.
      ...(isForm ? {} : { 'Content-Type': 'application/json' }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options?.headers ?? {}),
    },
    cache: 'no-store',
  })
  let body: unknown = null
  try {
    body = await res.json()
  } catch {
    // non-JSON response
  }
  if (!res.ok) {
    if (res.status === 401) {
      // Session gone/expired — drop the stored token so the app returns to
      // the login screen instead of retrying with dead credentials.
      setAuthToken(null)
    }
    const message =
      (body && typeof body === 'object' && 'error' in body && typeof body.error === 'string'
        ? body.error
        : null) ?? `Request failed (${res.status})`
    throw new ApiError(message, res.status)
  }
  return body as T
}

export const api = {
  get: <T>(url: string) => request<T>(url),
  post: <T>(url: string, data: unknown) =>
    request<T>(url, { method: 'POST', body: JSON.stringify(data) }),
  put: <T>(url: string, data: unknown) =>
    request<T>(url, { method: 'PUT', body: JSON.stringify(data) }),
  patch: <T>(url: string, data: unknown) =>
    request<T>(url, { method: 'PATCH', body: JSON.stringify(data) }),
  del: <T>(url: string) => request<T>(url, { method: 'DELETE' }),
  /** multipart upload — the browser sets the Content-Type boundary itself */
  postForm: <T>(url: string, form: FormData) => request<T>(url, { method: 'POST', body: form }),
}

/** Build a query string from an object, skipping empty/null/undefined values. */
export function qs(params: Record<string, string | number | null | undefined>): string {
  const sp = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v !== null && v !== undefined && v !== '') sp.set(k, String(v))
  }
  const s = sp.toString()
  return s ? `?${s}` : ''
}
