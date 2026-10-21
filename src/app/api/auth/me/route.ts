// GET /api/auth/me — always 200: { user: SessionUser | null }
import { getSessionUser } from '@/lib/auth'
import { ok } from '@/lib/api-helpers'

export async function GET() {
  try {
    const user = await getSessionUser()
    return ok({ user })
  } catch (err) {
    console.error('[api/auth/me]', err)
    return ok({ user: null })
  }
}
