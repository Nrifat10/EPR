'use client'

// Settings → AI Assistant section: provider config (encrypted key, model,
// limits, test connection) + usage dashboard (per-user tokens & cost) +
// admin request logs. Lives in the Settings page like EInvoiceSettingsSection.
import { useCallback, useEffect, useState } from 'react'
import {
  Activity,
  BadgeCheck,
  Bot,
  Coins,
  KeyRound,
  Loader2,
  PlugZap,
  RotateCcw,
  Save,
  Search,
  ShieldCheck,
  Sparkles,
  XCircle,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { SectionCard } from '@/components/app/shared/page-header'
import { api } from '@/lib/api-client'
import { useAppStore, can } from '@/lib/store'
import { formatDateTime } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { AiLogRow, AiSettingsView, AiUsageView } from '@/lib/types'

type ProviderKey = AiSettingsView['provider']

const PROVIDERS: { key: ProviderKey; label: string; hint: string; needsKey: boolean }[] = [
  { key: 'builtin', label: 'Built-in GLM (sandbox)', hint: 'Ready out of the box — no API key needed. Runs on this server.', needsKey: false },
  { key: 'zhipu', label: 'Zhipu GLM API', hint: 'Direct Zhipu API with your key (open.bigmodel.cn).', needsKey: true },
  { key: 'anthropic', label: 'Anthropic Claude', hint: 'Claude models via api.anthropic.com with your key.', needsKey: true },
  { key: 'openai', label: 'OpenAI', hint: 'GPT models via api.openai.com with your key.', needsKey: true },
]

export function AiSettingsSection() {
  const { user } = useAppStore()
  const canManage = can(user, 'ai.managesettings')
  const canLogs = can(user, 'ai.viewlogs')

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null)
  const [form, setForm] = useState<AiSettingsView | null>(null)
  const [apiKey, setApiKey] = useState('') // write-only
  const [usage, setUsage] = useState<AiUsageView | null>(null)
  const [logs, setLogs] = useState<AiLogRow[] | null>(null)
  const [logSearch, setLogSearch] = useState('')

  const loadSettings = useCallback(async () => {
    try {
      const res = await api.get<{ settings: AiSettingsView }>('/api/ai/settings')
      setForm(res.settings)
      setApiKey('')
    } catch {
      // permission or offline — leave empty
    } finally {
      setLoading(false)
    }
  }, [])

  const loadUsage = useCallback(async () => {
    if (!canLogs) return
    try {
      const res = await api.get<AiUsageView>('/api/ai/usage')
      setUsage(res)
    } catch {
      setUsage(null)
    }
  }, [canLogs])

  const loadLogs = useCallback(
    async (q?: string) => {
      if (!canLogs) return
      try {
        const res = await api.get<{ data: AiLogRow[] }>(`/api/ai/logs?pageSize=25${q ? `&q=${encodeURIComponent(q)}` : ''}`)
        setLogs(res.data)
      } catch {
        setLogs([])
      }
    },
    [canLogs]
  )

  useEffect(() => {
    if (canManage) void loadSettings()
    else setLoading(false)
    void loadUsage()
    void loadLogs()
  }, [canManage, loadSettings, loadUsage, loadLogs])

  // debounced log search
  useEffect(() => {
    const t = setTimeout(() => void loadLogs(logSearch || undefined), 300)
    return () => clearTimeout(t)
  }, [logSearch, loadLogs])

  if (!canManage && !canLogs) return null

  const save = async () => {
    if (!form) return
    setSaving(true)
    try {
      const res = await api.put<{ settings: AiSettingsView }>('/api/ai/settings', {
        provider: form.provider,
        model: form.model,
        baseUrl: form.baseUrl,
        maxTokens: form.maxTokens,
        monthlyLimitSar: form.monthlyLimitSar,
        inCostPer1k: form.inCostPer1k,
        outCostPer1k: form.outCostPer1k,
        ...(apiKey.trim() !== '' ? { apiKey: apiKey.trim() } : {}),
      })
      setForm(res.settings)
      setApiKey('')
      toast.success('AI Assistant settings saved — the API key is encrypted on the server')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save settings')
    } finally {
      setSaving(false)
    }
  }

  const test = async () => {
    if (!form) return
    setTesting(true)
    setTestResult(null)
    try {
      const res = await api.post<{ ok: boolean; message: string }>('/api/ai/settings/test', {
        provider: form.provider,
        model: form.model,
        baseUrl: form.baseUrl || undefined,
        ...(apiKey.trim() !== '' ? { apiKey: apiKey.trim() } : {}),
      })
      setTestResult(res)
    } catch (e) {
      setTestResult({ ok: false, message: e instanceof Error ? e.message : 'Test failed' })
    } finally {
      setTesting(false)
    }
  }

  const activeProvider = PROVIDERS.find((p) => p.key === form?.provider)

  return (
    <SectionCard className="p-6">
      <div className="flex flex-wrap items-center gap-2.5">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-gold-soft ring-1 ring-gold/40">
          <Sparkles className="h-5 w-5 text-gold-deep" />
        </span>
        <div>
          <h2 className="text-base font-semibold">AI Assistant</h2>
          <p className="text-sm text-muted-foreground">
            Provider, usage limits and request logs for the ERP chat assistant.
          </p>
        </div>
      </div>

      {loading ? (
        <div className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading AI settings…
        </div>
      ) : canManage && form ? (
        <>
          {/* provider */}
          <div className="mt-5 grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                AI Provider
              </Label>
              <div className="grid gap-1.5">
                {PROVIDERS.map((p) => (
                  <button
                    key={p.key}
                    type="button"
                    disabled={!canManage}
                    onClick={() => setForm({ ...form, provider: p.key })}
                    className={cn(
                      'flex items-start gap-2.5 rounded-lg border p-2.5 text-left transition-all',
                      form.provider === p.key
                        ? 'border-gold bg-gold-soft/50 shadow-sm'
                        : 'border-border/70 hover:border-gold/50 hover:bg-muted/40'
                    )}
                  >
                    <span
                      className={cn(
                        'mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border',
                        form.provider === p.key ? 'border-gold-deep bg-gold-deep' : 'border-muted-foreground/40'
                      )}
                    >
                      {form.provider === p.key ? <BadgeCheck className="h-3 w-3 text-white" /> : null}
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold">{p.label}</span>
                      <span className="block text-[11px] leading-snug text-muted-foreground">{p.hint}</span>
                    </span>
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="ai-model" className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Model name
                </Label>
                <Input
                  id="ai-model"
                  value={form.model}
                  onChange={(e) => setForm({ ...form, model: e.target.value })}
                  placeholder={
                    form.provider === 'builtin'
                      ? 'GLM-4.5 (default)'
                      : form.provider === 'anthropic'
                        ? 'claude-sonnet-4-5'
                        : form.provider === 'openai'
                          ? 'gpt-4.1'
                          : 'glm-4.5'
                  }
                  disabled={!canManage}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ai-key" className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  <KeyRound className="h-3 w-3" /> API key {activeProvider?.needsKey ? '' : '(not required)'}
                </Label>
                <Input
                  id="ai-key"
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder={form.hasKey ? `Saved: ${form.apiKeyHint} — type to replace` : 'sk-… (stored encrypted, never shown again)'}
                  disabled={!canManage}
                  autoComplete="off"
                />
                <p className="flex items-center gap-1 text-[10px] text-muted-foreground">
                  <ShieldCheck className="h-3 w-3 shrink-0 text-emerald-600" />
                  AES-256-GCM encrypted on this server — used only from the backend, never sent to the browser.
                </p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ai-baseurl" className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Custom base URL (optional)
                </Label>
                <Input
                  id="ai-baseurl"
                  value={form.baseUrl}
                  onChange={(e) => setForm({ ...form, baseUrl: e.target.value })}
                  placeholder="Leave empty for the provider default"
                  disabled={!canManage}
                />
              </div>
            </div>
          </div>

          {/* limits + costs */}
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-1.5">
              <Label htmlFor="ai-maxtokens" className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Max response length (tokens)
              </Label>
              <Input
                id="ai-maxtokens"
                type="number"
                min={256}
                max={16000}
                value={form.maxTokens}
                onChange={(e) => setForm({ ...form, maxTokens: parseInt(e.target.value || '4000', 10) })}
                disabled={!canManage}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ai-limit" className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Monthly usage limit (SAR)
              </Label>
              <Input
                id="ai-limit"
                type="number"
                min={0}
                value={form.monthlyLimitSar}
                onChange={(e) => setForm({ ...form, monthlyLimitSar: parseFloat(e.target.value || '0') })}
                disabled={!canManage}
              />
              <p className="text-[10px] text-muted-foreground">0 = unlimited. When reached, the assistant pauses with a clear message.</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ai-in-cost" className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Cost / 1k input tokens (SAR)
              </Label>
              <Input
                id="ai-in-cost"
                type="number"
                min={0}
                step="0.0001"
                value={form.inCostPer1k}
                onChange={(e) => setForm({ ...form, inCostPer1k: parseFloat(e.target.value || '0') })}
                disabled={!canManage}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ai-out-cost" className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Cost / 1k output tokens (SAR)
              </Label>
              <Input
                id="ai-out-cost"
                type="number"
                min={0}
                step="0.0001"
                value={form.outCostPer1k}
                onChange={(e) => setForm({ ...form, outCostPer1k: parseFloat(e.target.value || '0') })}
                disabled={!canManage}
              />
            </div>
          </div>

          {/* actions */}
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Button onClick={() => void save()} disabled={saving || !canManage} className="gap-1.5">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save settings
            </Button>
            <Button variant="outline" onClick={() => void test()} disabled={testing || !canManage} className="gap-1.5">
              {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlugZap className="h-4 w-4" />} Test connection
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                void loadSettings()
                setTestResult(null)
              }}
              className="gap-1.5 text-muted-foreground"
            >
              <RotateCcw className="h-3.5 w-3.5" /> Reset form
            </Button>
            {testResult ? (
              <span
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium',
                  testResult.ok
                    ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
                    : 'border-destructive/40 bg-destructive/10 text-destructive'
                )}
              >
                {testResult.ok ? <BadgeCheck className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />}
                {testResult.message}
              </span>
            ) : null}
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
            The built-in provider works offline on this server. External providers (Zhipu / Anthropic /
            OpenAI) need outbound network access and your own API key; if a provider fails, the rest of
            the ERP keeps working normally.
          </p>
        </>
      ) : null}

      {/* ── usage dashboard ── */}
      {canLogs ? (
        <div className="mt-6 border-t border-border/60 pt-5">
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <Coins className="h-4 w-4 text-gold-deep" /> Usage — {usage?.month.label ?? 'this month'}
          </h3>
          {usage ? (
            <>
              <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Stat label="Requests" value={usage.month.requests.toLocaleString()} />
                <Stat label="Total tokens" value={usage.month.totalTokens.toLocaleString()} />
                <Stat
                  label="Est. cost"
                  value={`SAR ${usage.month.costSar.toFixed(4)}`}
                  warn={form ? form.monthlyLimitSar > 0 && usage.month.costSar >= form.monthlyLimitSar * 0.8 : false}
                />
                <Stat label="6-month cost" value={`SAR ${usage.sixMonthCost.toFixed(2)}`} />
              </div>
              {usage.perUser.length > 0 ? (
                <div className="mt-4 overflow-x-auto rounded-lg border border-border/60">
                  <table className="w-full text-xs">
                    <thead className="bg-muted/60 text-muted-foreground">
                      <tr>
                        <th className="px-3 py-2 text-left font-semibold">User</th>
                        <th className="px-3 py-2 text-right font-semibold">Requests</th>
                        <th className="px-3 py-2 text-right font-semibold">Input tokens</th>
                        <th className="px-3 py-2 text-right font-semibold">Output tokens</th>
                        <th className="px-3 py-2 text-right font-semibold">Est. cost (SAR)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {usage.perUser.map((u) => (
                        <tr key={u.userName} className="border-t border-border/40">
                          <td className="px-3 py-2 font-medium">{u.userName}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{u.requests.toLocaleString()}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{u.promptTokens.toLocaleString()}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{u.completionTokens.toLocaleString()}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{u.costSar.toFixed(4)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="mt-3 text-xs text-muted-foreground">No AI requests logged yet this month.</p>
              )}
            </>
          ) : (
            <p className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading usage…
            </p>
          )}
        </div>
      ) : null}

      {/* ── request logs ── */}
      {canLogs ? (
        <div className="mt-6 border-t border-border/60 pt-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="flex items-center gap-2 text-sm font-semibold">
              <Activity className="h-4 w-4 text-gold-deep" /> Request log
            </h3>
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={logSearch}
                onChange={(e) => setLogSearch(e.target.value)}
                placeholder="Search questions…"
                className="h-8 w-56 border-border/60 bg-muted/40 pl-8 text-xs"
              />
            </div>
          </div>
          <div className="nice-scrollbar mt-3 max-h-80 overflow-y-auto rounded-lg border border-border/60">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-muted/60 text-muted-foreground backdrop-blur">
                <tr>
                  <th className="px-3 py-2 text-left font-semibold">When</th>
                  <th className="px-3 py-2 text-left font-semibold">User</th>
                  <th className="px-3 py-2 text-left font-semibold">Question</th>
                  <th className="px-3 py-2 text-left font-semibold">Tools</th>
                  <th className="px-3 py-2 text-right font-semibold">Tokens</th>
                  <th className="px-3 py-2 text-right font-semibold">Cost</th>
                </tr>
              </thead>
              <tbody>
                {logs === null ? (
                  <tr>
                    <td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">
                      <Loader2 className="mr-1.5 inline h-3.5 w-3.5 animate-spin" /> Loading…
                    </td>
                  </tr>
                ) : logs.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">
                      No requests logged yet.
                    </td>
                  </tr>
                ) : (
                  logs.map((l) => (
                    <tr key={l.id} className="border-t border-border/40 align-top">
                      <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">{formatDateTime(l.createdAt)}</td>
                      <td className="whitespace-nowrap px-3 py-2 font-medium">{l.userName ?? '—'}</td>
                      <td className="max-w-72 px-3 py-2">
                        <span className="line-clamp-2">{l.question}</span>
                        {l.error ? (
                          <span className="mt-0.5 block text-[10px] text-destructive" title={l.error}>
                            ✗ {l.error.slice(0, 80)}
                          </span>
                        ) : null}
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex max-w-40 flex-wrap gap-1">
                          {aggregateTools(l.toolsCalled).length === 0 ? (
                            <span className="text-muted-foreground">—</span>
                          ) : (
                            aggregateTools(l.toolsCalled).map((t) => (
                              <Badge key={t.name} variant="outline" className="px-1.5 py-0 font-mono text-[9px] font-normal">
                                {t.name}
                                {t.count > 1 ? <span className="ml-0.5 text-muted-foreground">×{t.count}</span> : null}
                              </Badge>
                            ))
                          )}
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                        {l.totalTokens.toLocaleString()}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                        {l.costSar > 0 ? l.costSar.toFixed(4) : '—'}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {/* security notes */}
      <div className="mt-6 rounded-lg border border-border/60 bg-muted/30 p-3 text-[11px] leading-relaxed text-muted-foreground">
        <p className="mb-1 flex items-center gap-1.5 font-semibold text-foreground">
          <Bot className="h-3.5 w-3.5" /> Security
        </p>
        Only users with the “Use AI Assistant” permission can chat (set per role in Roles &amp; Permissions).
        Payroll and salary answers are further restricted to Admin / Accounts roles. Iqama &amp; Passport
        numbers are masked to the last 4 digits unless a role has “See full Iqama/Passport numbers”.
        Every request is logged with the question, tools called and tokens used. The AI can only READ
        data and prepare drafts — it never saves, issues, sends or deletes anything.
      </div>
    </SectionCard>
  )
}

function Stat({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="rounded-lg border border-border/60 bg-muted/20 p-3">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={cn('mt-0.5 text-lg font-bold tabular-nums', warn && 'text-amber-600 dark:text-amber-400')}>{value}</p>
    </div>
  )
}

function parseTools(raw: string): string[] {
  try {
    const v = JSON.parse(raw)
    return Array.isArray(v) ? v.map(String) : []
  } catch {
    return []
  }
}

/** Aggregate tool calls so each unique tool appears once (with call count) — avoids duplicate React keys. */
function aggregateTools(raw: string): { name: string; count: number }[] {
  const counts = new Map<string, number>()
  for (const t of parseTools(raw)) {
    counts.set(t, (counts.get(t) ?? 0) + 1)
  }
  return [...counts.entries()].map(([name, count]) => ({ name, count }))
}
