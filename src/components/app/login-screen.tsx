'use client'

import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import Image from 'next/image'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  AlertTriangle,
  Calculator,
  Check,
  CheckCircle2,
  ChevronDown,
  Copy,
  Crown,
  Eye,
  KeyRound,
  Loader2,
  Lock,
  LogIn,
  Mail,
  MapPin,
  ShieldCheck,
  User,
  Users,
} from 'lucide-react'
import { api, setAuthToken } from '@/lib/api-client'
import { useAppStore } from '@/lib/store'
import type { SessionUser } from '@/lib/types'
import { cn } from '@/lib/utils'

const REMEMBER_KEY = 'lig:remembered-email'

/** Demo access accounts — roles seeded with the system (click a row to fill the form). */
const DEMO_ACCOUNTS = [
  {
    role: 'Owner · Super Admin',
    email: 'admin@landmarkintergulf.com',
    password: 'Landmark@2025',
    icon: Crown,
    highlight: true,
    desc: 'Full access to every module and setting',
  },
  {
    role: 'Accountant',
    email: 'accountant@example.com',
    password: 'Accountant@2025',
    icon: Calculator,
    highlight: false,
    desc: 'Accounts, payroll and financial reports',
  },
  {
    role: 'HR Manager',
    email: 'hr@example.com',
    password: 'HrManager@2025',
    icon: Users,
    highlight: false,
    desc: 'Staff records, attendance and deployment',
  },
  {
    role: 'Viewer',
    email: 'viewer@example.com',
    password: 'Viewer@2025',
    icon: Eye,
    highlight: false,
    desc: 'Read-only dashboards and reports',
  },
] as const

type BootstrapState =
  | { status: 'checking' }
  | { status: 'ready' }
  | { status: 'empty' }
  | { status: 'initializing' }

/**
 * Split the company address (comma-separated, building/office name first) into
 * an emphasized heading line and postal lines of a comfortable width for the
 * login brand panel. "Al Suwedhi Business Centre, Office # 103, 1st Floor,
 * P.O.Box 35712, Building 5526, 4th Street, Distt. Al Wahah, Jubail,
 * Kingdom of Saudi Arabia" becomes:
 *   Al Suwedhi Business Centre            (heading)
 *   Office # 103, 1st Floor
 *   P.O.Box 35712, Building 5526
 *   4th Street, Distt. Al Wahah
 *   Jubail, Kingdom of Saudi Arabia
 */
function formatAddress(address: string): { title: string; lines: string[] } {
  const parts = address
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean)
  if (parts.length === 0) return { title: '', lines: [] }
  if (parts.length === 1) return { title: parts[0], lines: [] }
  const lines: string[] = []
  let current = ''
  for (const part of parts.slice(1)) {
    const candidate = current ? `${current}, ${part}` : part
    if (current && candidate.length > 34) {
      lines.push(current)
      current = part
    } else {
      current = candidate
    }
  }
  if (current) lines.push(current)
  return { title: parts[0], lines }
}

/** Shared eye / eye-off toggle used inside password inputs. */
function PasswordToggle({
  visible,
  onToggle,
}: {
  visible: boolean
  onToggle: () => void
}) {
  return (
    <button
      type="button"
      tabIndex={-1}
      onClick={onToggle}
      className="absolute inset-y-0 right-0 flex w-10 items-center justify-center rounded-r-md text-muted-foreground transition-colors hover:text-foreground"
      aria-label={visible ? 'Hide password' : 'Show password'}
    >
      {visible ? (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
          <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
          <path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" />
          <line x1="2" x2="22" y1="2" y2="22" />
        </svg>
      ) : (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
          <circle cx="12" cy="12" r="3" />
        </svg>
      )}
    </button>
  )
}

export function LoginScreen() {
  const { settings, setUser, setSettings } = useAppStore()
  const { title: officeTitle, lines: officeLines } = formatAddress(settings.address)
  const hasAddress = officeTitle.length > 0

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [remember, setRemember] = useState(false)
  const [capsLockOn, setCapsLockOn] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [errorShake, setErrorShake] = useState(0)
  const [loading, setLoading] = useState(false)
  const [showAccounts, setShowAccounts] = useState(false)
  const [copiedKey, setCopiedKey] = useState<string | null>(null)
  const [bootstrap, setBootstrap] = useState<BootstrapState>({ status: 'checking' })

  // First-run setup form state (shown only while the database has no users)
  const [setupName, setSetupName] = useState('')
  const [setupEmail, setSetupEmail] = useState('')
  const [setupPassword, setSetupPassword] = useState('')
  const [setupConfirm, setSetupConfirm] = useState('')
  const [showSetupPassword, setShowSetupPassword] = useState(false)
  const [setupError, setSetupError] = useState<string | null>(null)

  // Detect a fresh installation (no user accounts) so the owner can create the
  // first administrator account instead of being locked out.
  useEffect(() => {
    let cancelled = false
    api
      .get<{ needsBootstrap: boolean }>('/api/bootstrap')
      .then((res) => {
        if (!cancelled) setBootstrap({ status: res.needsBootstrap ? 'empty' : 'ready' })
      })
      .catch(() => {
        if (!cancelled) setBootstrap({ status: 'ready' })
      })
    return () => {
      cancelled = true
    }
  }, [])

  // Prefill a remembered email (convenience only — the password is never stored)
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(REMEMBER_KEY)
      if (saved) {
        setEmail(saved)
        setRemember(true)
      }
    } catch {
      // localStorage unavailable (private mode) — ignore
    }
  }, [])

  function trackCapsLock(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.getModifierState) setCapsLockOn(e.getModifierState('CapsLock'))
  }

  /** Copy an account's email + password as "email / password" to the clipboard. */
  async function copyAccount(key: string, email: string, password: string) {
    try {
      await navigator.clipboard.writeText(`${email} / ${password}`)
      setCopiedKey(key)
      window.setTimeout(() => setCopiedKey((k) => (k === key ? null : k)), 1600)
    } catch {
      toast.error('Copy failed', { description: 'Please select the text and copy manually.' })
    }
  }

  /** Fill the sign-in form with a demo account's credentials. */
  function fillAccount(account: (typeof DEMO_ACCOUNTS)[number]) {
    setEmail(account.email)
    setPassword(account.password)
    setError(null)
    toast.success(`${account.role} credentials filled`, {
      description: 'Press “Sign in” to continue.',
    })
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      const res = await api.post<{ user: SessionUser; token?: string }>('/api/auth/login', {
        email,
        password,
      })
      // Store the session token for iframe contexts (preview panel) where
      // cookies are blocked — sent as Authorization: Bearer by api-client.
      setAuthToken(res.token ?? null)
      try {
        if (remember) window.localStorage.setItem(REMEMBER_KEY, email.trim())
        else window.localStorage.removeItem(REMEMBER_KEY)
      } catch {
        // ignore storage errors
      }
      setUser(res.user)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed')
      setErrorShake((n) => n + 1) // retrigger shake animation
    } finally {
      setLoading(false)
    }
  }

  async function handleCreateAdmin(e: React.FormEvent) {
    e.preventDefault()
    setSetupError(null)

    const name = setupName.trim()
    const mail = setupEmail.trim()
    if (name.length < 2) return setSetupError('Enter the administrator\'s full name.')
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail)) return setSetupError('Enter a valid email address.')
    if (setupPassword.length < 8) return setSetupError('Password must be at least 8 characters.')
    if (setupPassword !== setupConfirm) return setSetupError('Passwords do not match.')

    setBootstrap({ status: 'initializing' })
    try {
      await api.post('/api/bootstrap', { name, email: mail, password: setupPassword })
      // Refresh branding settings that were just created with their defaults
      api
        .get<{ settings: typeof settings }>('/api/settings')
        .then((res) => setSettings(res.settings))
        .catch(() => {})
      toast.success('Administrator account created', {
        description: 'Sign in below with your new credentials to start using the system.',
      })
      setEmail(mail)
      setPassword('')
      setSetupPassword('')
      setSetupConfirm('')
      setBootstrap({ status: 'ready' })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create the administrator account')
      setSetupError(err instanceof Error ? err.message : 'Failed to create the administrator account')
      setBootstrap({ status: 'empty' })
    }
  }

  // Shared card chrome — gold accent rule on top of a clean white card.
  const CARD_CLASS =
    'overflow-hidden border-white/10 bg-white/95 shadow-2xl shadow-black/30 backdrop-blur dark:bg-card/95'
  const goldRule = (
    <div aria-hidden className="h-[3px] w-full bg-gradient-to-r from-transparent via-[#D4AF37] to-transparent" />
  )

  const cardContent = (
    <>
      {goldRule}
      <CardHeader className="space-y-1 pb-2">
        <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl border border-[#D4AF37]/40 bg-gradient-to-b from-[#D4AF37]/15 to-[#D4AF37]/5 shadow-sm">
          <Lock className="h-5 w-5 text-[#8B6F1F] dark:text-[#D4AF37]" aria-hidden />
        </div>
        <CardTitle className="text-[22px] font-semibold tracking-tight">Sign in</CardTitle>
        <CardDescription className="text-[13px]">
          Enter your credentials to access the admin system
        </CardDescription>
      </CardHeader>
      <CardContent className="pt-4">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label
              htmlFor="email"
              className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/90"
            >
              Email
            </Label>
            <div className="relative">
              <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/70" />
              <Input
                id="email"
                type="email"
                autoComplete="email"
                placeholder="you@company.com"
                className="h-10 pl-9"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label
                htmlFor="password"
                className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/90"
              >
                Password
              </Label>
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="text-xs font-medium text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline"
              >
                {showPassword ? 'Hide' : 'Show'}
              </button>
            </div>
            <div className="relative">
              <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/70" />
              <Input
                id="password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                placeholder="••••••••"
                className={cn('h-10 pl-9 pr-10', capsLockOn && 'border-amber-400/70 dark:border-amber-500/50')}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={trackCapsLock}
                onKeyUp={trackCapsLock}
                required
                aria-describedby={capsLockOn ? 'capslock-warning' : undefined}
              />
              <PasswordToggle visible={showPassword} onToggle={() => setShowPassword((v) => !v)} />
            </div>
            {capsLockOn ? (
              <p
                id="capslock-warning"
                className="flex items-center gap-1.5 text-xs font-medium text-amber-600 dark:text-amber-400"
                role="status"
              >
                <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
                Caps Lock is on
              </p>
            ) : null}
          </div>

          {error ? (
            <motion.p
              key={errorShake}
              initial={{ x: 0 }}
              animate={errorShake > 0 ? { x: [0, -7, 7, -4, 4, 0] } : {}}
              transition={{ duration: 0.4, ease: 'easeInOut' }}
              className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive"
              role="alert"
              aria-live="assertive"
            >
              {error}
            </motion.p>
          ) : null}

          <label
            htmlFor="remember-email"
            className="flex w-fit cursor-pointer select-none items-center gap-2 text-xs text-muted-foreground"
          >
            <Checkbox
              id="remember-email"
              checked={remember}
              onCheckedChange={(v) => setRemember(v === true)}
            />
            Remember email
          </label>

          <Button
            type="submit"
            size="lg"
            className="w-full text-[15px] font-semibold shadow-lg shadow-primary/25 transition-all hover:-translate-y-px hover:shadow-xl active:translate-y-0"
            disabled={loading}
          >
            {loading ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <LogIn className="mr-2 h-4 w-4" />
            )}
            Sign in
          </Button>

          {/* Demo access accounts — click a row to fill the form */}
          <div className="rounded-xl border bg-muted/40">
            <button
              type="button"
              onClick={() => setShowAccounts((v) => !v)}
              aria-expanded={showAccounts}
              aria-controls="demo-accounts"
              className="flex w-full items-center justify-center gap-2 px-3 py-2.5 text-xs font-semibold text-muted-foreground transition-colors hover:text-foreground"
            >
              <KeyRound className="h-3.5 w-3.5 text-[#8B6F1F] dark:text-[#D4AF37]/90" aria-hidden />
              Demo access accounts
              <ChevronDown
                className={cn('h-3.5 w-3.5 transition-transform duration-200', showAccounts && 'rotate-180')}
                aria-hidden
              />
            </button>
            {showAccounts ? (
              <div id="demo-accounts" className="space-y-1.5 border-t p-2">
                {DEMO_ACCOUNTS.map((account) => {
                  const Icon = account.icon
                  const key = `${account.email}`
                  return (
                    <div
                      key={key}
                      className={cn(
                        'group relative flex items-start gap-2.5 rounded-lg border p-2.5 transition-all',
                        account.highlight
                          ? 'border-[#D4AF37]/50 bg-gradient-to-r from-[#D4AF37]/[0.08] to-transparent'
                          : 'border-transparent bg-background/60 hover:border-border hover:bg-background'
                      )}
                    >
                      <span
                        className={cn(
                          'mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md',
                          account.highlight
                            ? 'bg-[#D4AF37]/15 text-[#8B6F1F] ring-1 ring-[#D4AF37]/40 dark:text-[#D4AF37]'
                            : 'bg-muted text-muted-foreground'
                        )}
                        aria-hidden
                      >
                        <Icon className="h-3.5 w-3.5" />
                      </span>
                      <button
                        type="button"
                        onClick={() => fillAccount(account)}
                        className="min-w-0 flex-1 text-left"
                        title={`${account.desc} — click to fill the sign-in form`}
                      >
                        <p
                          className={cn(
                            'flex items-center gap-1.5 text-xs font-semibold leading-tight',
                            account.highlight ? 'text-foreground' : 'text-foreground/90'
                          )}
                        >
                          {account.role}
                          {account.highlight ? (
                            <span className="rounded-full bg-[#D4AF37]/15 px-1.5 py-px text-[9px] font-bold uppercase tracking-wider text-[#8B6F1F] ring-1 ring-[#D4AF37]/40 dark:text-[#D4AF37]">
                              You
                            </span>
                          ) : null}
                        </p>
                        <p className="mt-1 truncate font-mono text-[11px] leading-tight text-muted-foreground">
                          {account.email}
                        </p>
                        <p className="mt-0.5 font-mono text-[11px] leading-tight text-muted-foreground/80">
                          ••••• {account.password}
                        </p>
                      </button>
                      <button
                        type="button"
                        onClick={() => copyAccount(key, account.email, account.password)}
                        className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground/50 transition-all hover:bg-muted hover:text-foreground focus-visible:opacity-100 focus-visible:outline-focus md:opacity-0 md:group-hover:opacity-100"
                        aria-label={`Copy ${account.role} credentials`}
                        title="Copy email and password"
                      >
                        {copiedKey === key ? (
                          <Check className="h-3.5 w-3.5 text-green-600 dark:text-green-400" />
                        ) : (
                          <Copy className="h-3.5 w-3.5" />
                        )}
                      </button>
                    </div>
                  )
                })}
                <p className="px-1 pt-0.5 pb-0.5 text-center text-[10px] leading-relaxed text-muted-foreground/70">
                  Click any account to auto-fill — demo data, safe to explore
                </p>
              </div>
            ) : null}
          </div>

          <div className="flex items-center justify-center gap-1.5 border-t pt-3 text-[11px] leading-snug text-muted-foreground/75">
            <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-[#8B6F1F] dark:text-[#D4AF37]/80" aria-hidden />
            All access is monitored and logged — authorized personnel only
          </div>
        </form>
      </CardContent>
    </>
  )

  const setupForm = (
    <form onSubmit={handleCreateAdmin} className="space-y-4">
      <div className="space-y-1.5">
        <Label
          htmlFor="setup-name"
          className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/90"
        >
          Administrator name
        </Label>
        <div className="relative">
          <User className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/70" />
          <Input
            id="setup-name"
            type="text"
            autoComplete="name"
            placeholder="e.g. Faisal Al-Otaibi"
            className="h-10 pl-9"
            value={setupName}
            onChange={(e) => setSetupName(e.target.value)}
            maxLength={80}
            required
          />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label
          htmlFor="setup-email"
          className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/90"
        >
          Email
        </Label>
        <div className="relative">
          <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/70" />
          <Input
            id="setup-email"
            type="email"
            autoComplete="email"
            placeholder="you@company.com"
            className="h-10 pl-9"
            value={setupEmail}
            onChange={(e) => setSetupEmail(e.target.value)}
            maxLength={120}
            required
          />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label
          htmlFor="setup-password"
          className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/90"
        >
          Password
        </Label>
        <div className="relative">
          <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/70" />
          <Input
            id="setup-password"
            type={showSetupPassword ? 'text' : 'password'}
            autoComplete="new-password"
            placeholder="At least 8 characters"
            className="h-10 pl-9 pr-10"
            value={setupPassword}
            onChange={(e) => setSetupPassword(e.target.value)}
            maxLength={72}
            required
            aria-describedby="setup-password-hint"
          />
          <PasswordToggle
            visible={showSetupPassword}
            onToggle={() => setShowSetupPassword((v) => !v)}
          />
        </div>
        <p id="setup-password-hint" className="text-xs text-muted-foreground">
          Minimum 8 characters — choose something strong.
        </p>
      </div>
      <div className="space-y-1.5">
        <Label
          htmlFor="setup-confirm"
          className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/90"
        >
          Confirm password
        </Label>
        <div className="relative">
          <CheckCircle2 className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/70" />
          <Input
            id="setup-confirm"
            type={showSetupPassword ? 'text' : 'password'}
            autoComplete="new-password"
            placeholder="Repeat the password"
            className="h-10 pl-9"
            value={setupConfirm}
            onChange={(e) => setSetupConfirm(e.target.value)}
            maxLength={72}
            required
          />
        </div>
      </div>

      {setupError ? (
        <p
          className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive"
          role="alert"
          aria-live="assertive"
        >
          {setupError}
        </p>
      ) : null}

      <Button type="submit" className="w-full text-[15px] font-semibold" size="lg">
        <ShieldCheck className="mr-2 h-4 w-4" />
        Create administrator account
      </Button>
    </form>
  )

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-gradient-to-br from-[#0B1832] via-[#0F1F3D] to-[#0A1226] p-4">
      {/* decorative grid — gold threads */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-30"
        style={{
          backgroundImage:
            'linear-gradient(rgba(212,175,55,0.07) 1px, transparent 1px), linear-gradient(90deg, rgba(212,175,55,0.07) 1px, transparent 1px)',
          backgroundSize: '44px 44px',
        }}
      />
      {/* soft corner glows — gold + navy */}
      <div
        aria-hidden
        className="pointer-events-none absolute -left-32 -top-32 h-96 w-96 rounded-full bg-[#D4AF37]/10 blur-3xl"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-32 -right-32 h-96 w-96 rounded-full bg-[#2A4A8C]/20 blur-3xl"
      />

      <motion.div
        initial={{ opacity: 0, y: 16, scale: 0.985 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.4, ease: 'easeOut' }}
        className="relative grid w-full max-w-4xl gap-8 md:grid-cols-2"
      >
        {/* Brand panel (desktop) */}
        <div className="hidden flex-col justify-between rounded-2xl border border-white/10 bg-white/[0.04] p-8 backdrop-blur md:flex">
          <div>
            {/* Full logo lockup on a white card so the brand prints true */}
            <div className="rounded-2xl bg-white p-6 shadow-2xl shadow-black/40">
              <Image
                src="/logo.png"
                alt={`${settings.companyName} — LANDMARK INTER GULF LLC`}
                width={480}
                height={322}
                priority
                className="h-auto w-full"
                unoptimized
              />
            </div>
            {/* gold-ruled tagline, echoing the logo's flanking lines */}
            <p className="mt-5 flex items-center justify-center gap-3 text-[11px] font-semibold uppercase tracking-[0.32em] text-[#D4AF37]">
              <span className="h-px w-10 bg-gradient-to-r from-transparent to-[#D4AF37]/70" aria-hidden />
              Workforce · Payroll · Accounts
              <span className="h-px w-10 bg-gradient-to-l from-transparent to-[#D4AF37]/70" aria-hidden />
            </p>
          </div>
          <div className="space-y-5">
            <div className="flex items-start gap-3">
              <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-[#D4AF37]" />
              <p className="text-sm leading-relaxed text-[#E9E6DC]/85">
                Complete manpower management: projects, staff, attendance, monthly payroll,
                salary sheets and company accounting — in SAR.
              </p>
            </div>
            {hasAddress ? (
              <div className="rounded-xl border border-[#D4AF37]/25 bg-black/25 p-4">
                <div className="flex items-start gap-3">
                  <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#D4AF37]/15 ring-1 ring-[#D4AF37]/30">
                    <MapPin className="h-4.5 w-4.5 text-[#D4AF37]" aria-hidden />
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold tracking-wide text-white">{officeTitle}</p>
                    <div className="mt-1 space-y-0.5">
                      {officeLines.map((line) => (
                        <p key={line} className="text-[13px] leading-relaxed text-[#E9E6DC]/95">
                          {line}
                        </p>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        </div>

        {/* Mobile brand header */}
        <div className="flex items-center gap-3 md:hidden">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-white shadow-lg ring-1 ring-black/10">
            <Image
              src={settings.logo ?? '/logo-mark.png'}
              alt={settings.companyName}
              width={48}
              height={48}
              className="h-full w-full object-contain p-1"
              unoptimized
            />
          </div>
          <div className="min-w-0">
            <p className="truncate text-base font-bold leading-tight text-white">{settings.companyName}</p>
            <p className="truncate text-[10px] font-semibold uppercase tracking-[0.18em] text-[#D4AF37]">
              Workforce · Payroll · Accounts
            </p>
          </div>
        </div>

        {/* Login form / first-run setup state */}
        {bootstrap.status === 'empty' ? (
          <Card className={cn(CARD_CLASS, 'border-amber-200/60')}>
            {goldRule}
            <CardHeader className="space-y-1 pb-2">
              <div className="mb-1 flex h-11 w-11 items-center justify-center rounded-xl border border-[#D4AF37]/40 bg-gradient-to-b from-[#D4AF37]/15 to-[#D4AF37]/5 shadow-sm">
                <ShieldCheck className="h-5 w-5 text-[#8B6F1F] dark:text-[#D4AF37]" aria-hidden />
              </div>
              <CardTitle className="text-[22px] font-semibold tracking-tight">Welcome — first-time setup</CardTitle>
              <CardDescription className="text-[13px]">
                This system is brand new. Create the administrator account you will use to
                sign in and manage everything else.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 pt-4">
              {setupForm}
              <p className="text-center text-xs leading-relaxed text-muted-foreground">
                Your data starts empty and private — clients, staff and payroll records are
                created only by you, inside the system.
              </p>
            </CardContent>
          </Card>
        ) : bootstrap.status === 'initializing' ? (
          <Card className={CARD_CLASS}>
            {goldRule}
            <CardContent className="flex flex-col items-center gap-3 py-14">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <p className="text-sm font-medium">Creating your administrator account…</p>
              <p className="text-xs text-muted-foreground">Setting up roles and default settings</p>
            </CardContent>
          </Card>
        ) : (
          <Card className={CARD_CLASS}>
            {cardContent}
          </Card>
        )}

        {/* Office address (mobile) — same block as the desktop brand panel */}
        {hasAddress ? (
          <div className="rounded-xl border border-white/10 bg-white/[0.04] p-4 text-center md:hidden">
            <p className="flex items-center justify-center gap-1.5 text-xs font-semibold tracking-wide text-white">
              <MapPin className="h-3.5 w-3.5 shrink-0 text-[#D4AF37]" aria-hidden />
              {officeTitle}
            </p>
            <div className="mt-1.5 space-y-0.5">
              {officeLines.map((line) => (
                <p key={line} className="text-xs leading-relaxed text-[#E9E6DC]/90">
                  {line}
                </p>
              ))}
            </div>
          </div>
        ) : null}
      </motion.div>
    </div>
  )
}
