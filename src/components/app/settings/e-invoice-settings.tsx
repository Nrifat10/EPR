'use client'

// E-Invoice settings sections (rendered inside the Settings view):
//   1. "E-Invoice" — print config: A4 letterhead artwork + top/bottom content
//      margins, authorized signature + company stamp images, receiver
//      signature default, and the EN→AR translation provider + API key.
//   2. "Translation Glossary" — fixed EN→AR terms always applied before
//      machine translation.
// Both sections are permission-gated (settings.edit; view-only otherwise).
// Images upload immediately via PUT /api/e-invoice-config; everything else
// saves with the section's Save button.
import { useCallback, useEffect, useRef, useState } from 'react'
import { ImagePlus, Languages, Lightbulb, Loader2, Plus, Save, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

import { api } from '@/lib/api-client'
import { fileToDataUrl } from '@/lib/image-data-url'
import { can, useAppStore } from '@/lib/store'
import type { EInvoiceConfig, GlossaryTermRow } from '@/lib/types'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { SectionCard } from '@/components/app/shared/page-header'

type ImageField = 'letterhead' | 'signature' | 'stamp'

const PROVIDER_OPTIONS = [
  { value: 'builtin', label: 'Built-in AI (recommended)' },
  { value: 'google', label: 'Google Translate' },
  { value: 'deepl', label: 'DeepL' },
]

/** Small image preview with an optional "unset" dashed frame. */
function ImagePreview({
  src,
  alt,
  className,
  emptyLabel,
}: {
  src: string | null
  alt: string
  className?: string
  emptyLabel: string
}) {
  if (!src) {
    return (
      <div
        className={`flex items-center justify-center rounded-lg border border-dashed bg-muted/40 p-2 text-center text-[10px] font-medium leading-tight text-muted-foreground ${className ?? ''}`}
      >
        {emptyLabel}
      </div>
    )
  }
  return (
    <div className={`overflow-hidden rounded-lg border bg-white ${className ?? ''}`}>
      { }
      <img src={src} alt={alt} className="h-full w-full object-contain" />
    </div>
  )
}

export function EInvoiceSettingsSection() {
  const { user } = useAppStore()
  const canEdit = can(user, 'settings.edit')

  const [cfg, setCfg] = useState<EInvoiceConfig | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState<ImageField | null>(null)

  const [topMm, setTopMm] = useState('35')
  const [bottomMm, setBottomMm] = useState('22')
  const [showReceiver, setShowReceiver] = useState(true)
  const [provider, setProvider] = useState('builtin')
  const [apiKey, setApiKey] = useState('')

  const letterheadInputRef = useRef<HTMLInputElement>(null)
  const signatureInputRef = useRef<HTMLInputElement>(null)
  const stampInputRef = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await api.get<EInvoiceConfig>('/api/e-invoice-config')
      setCfg(res)
      setTopMm(String(res.topMm))
      setBottomMm(String(res.bottomMm))
      setShowReceiver(res.showReceiverSignature)
      setProvider(res.translateProvider)
      setApiKey('')
    } catch {
      setCfg(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  function applyConfig(res: EInvoiceConfig) {
    setCfg(res)
    setTopMm(String(res.topMm))
    setBottomMm(String(res.bottomMm))
    setShowReceiver(res.showReceiverSignature)
    setProvider(res.translateProvider)
  }

  /** Upload one of the three images — validated + saved immediately. */
  async function handleImageSelected(field: ImageField, file: File | undefined) {
    if (!file || !canEdit) return
    try {
      setUploading(field)
      const dataUrl = await fileToDataUrl(file)
      const res = await api.put<EInvoiceConfig>('/api/e-invoice-config', { [field]: dataUrl })
      applyConfig(res)
      toast.success(
        `${field === 'letterhead' ? 'Letterhead' : field === 'signature' ? 'Signature' : 'Stamp'} image saved`
      )
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not upload the image')
    } finally {
      setUploading(null)
      const ref =
        field === 'letterhead'
          ? letterheadInputRef
          : field === 'signature'
            ? signatureInputRef
            : stampInputRef
      if (ref.current) ref.current.value = ''
    }
  }

  /** Remove one of the three images (PUT null). */
  async function handleRemoveImage(field: ImageField) {
    if (!canEdit) return
    try {
      const res = await api.put<EInvoiceConfig>('/api/e-invoice-config', { [field]: null })
      applyConfig(res)
      toast.success(
        `${field === 'letterhead' ? 'Letterhead' : field === 'signature' ? 'Signature' : 'Stamp'} image removed`
      )
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not remove the image')
    }
  }

  async function handleSave() {
    if (!canEdit || saving) return
    const top = Math.round(Number(topMm))
    const bottom = Math.round(Number(bottomMm))
    if (!Number.isFinite(top) || top < 0 || top > 100 || !Number.isFinite(bottom) || bottom < 0 || bottom > 100) {
      toast.error('Margins must be numbers between 0 and 100 mm')
      return
    }
    setSaving(true)
    try {
      const res = await api.put<EInvoiceConfig>('/api/e-invoice-config', {
        topMm: top,
        bottomMm: bottom,
        showReceiverSignature: showReceiver,
        translateProvider: provider,
        // typed key replaces the stored one; empty keeps it server-side
        ...(apiKey.trim() !== '' ? { translateApiKey: apiKey.trim() } : {}),
      })
      applyConfig(res)
      setApiKey('')
      toast.success('E-Invoice settings saved')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save the E-Invoice settings')
    } finally {
      setSaving(false)
    }
  }

  async function handleClearApiKey() {
    if (!canEdit) return
    try {
      const res = await api.put<EInvoiceConfig>('/api/e-invoice-config', { translateApiKey: null })
      applyConfig(res)
      setApiKey('')
      toast.success('Translation API key cleared — the built-in provider will be used')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not clear the API key')
    }
  }

  function imageUploadBlock(
    field: ImageField,
    label: string,
    hint: string,
    ref: React.RefObject<HTMLInputElement | null>,
    previewClassName: string,
    emptyLabel: string
  ) {
    const src = cfg ? cfg[field] : null
    return (
      <div className="space-y-2">
        <Label>{label}</Label>
        <div className="flex flex-wrap items-start gap-4">
          <ImagePreview
            src={src}
            alt={label}
            className={`h-20 w-20 ${previewClassName}`}
            emptyLabel={emptyLabel}
          />
          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={ref}
              type="file"
              accept="image/png,image/jpeg"
              className="sr-only"
              onChange={(e) => void handleImageSelected(field, e.target.files?.[0])}
              aria-label={`Upload ${label.toLowerCase()}`}
              disabled={!canEdit || uploading !== null}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => ref.current?.click()}
              disabled={!canEdit || uploading !== null}
            >
              {uploading === field ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <ImagePlus className="h-4 w-4" />
              )}
              Upload
            </Button>
            {src ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void handleRemoveImage(field)}
                disabled={!canEdit || uploading !== null}
              >
                <Trash2 className="h-4 w-4" />
                Remove
              </Button>
            ) : null}
          </div>
        </div>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </div>
    )
  }

  return (
    <SectionCard className="p-6">
      <h2 className="text-base font-semibold">E-Invoice</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Print template for the bilingual ZATCA tax invoices — full-page A4 letterhead artwork,
        content margins, signature and stamp, and the Arabic auto-translation provider.
      </p>

      {loading ? (
        <div className="mt-6 flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading E-Invoice settings…
        </div>
      ) : (
        <div className="mt-6 space-y-6">
          <div className="space-y-2">
            <Label>Letterhead (full A4 page)</Label>
            <div className="flex flex-wrap items-start gap-4">
              <ImagePreview
                src={cfg?.letterhead ?? null}
                alt="Letterhead"
                className="aspect-[210/297] h-auto w-24"
                emptyLabel="No letterhead — upload a full-page A4 design"
              />
              <div className="flex flex-wrap items-center gap-2">
                <input
                  ref={letterheadInputRef}
                  type="file"
                  accept="image/png,image/jpeg"
                  className="sr-only"
                  onChange={(e) => void handleImageSelected('letterhead', e.target.files?.[0])}
                  aria-label="Upload letterhead image"
                  disabled={!canEdit || uploading !== null}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => letterheadInputRef.current?.click()}
                  disabled={!canEdit || uploading !== null}
                >
                  {uploading === 'letterhead' ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <ImagePlus className="h-4 w-4" />
                  )}
                  Upload
                </Button>
                {cfg?.letterhead ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => void handleRemoveImage('letterhead')}
                    disabled={!canEdit || uploading !== null}
                  >
                    <Trash2 className="h-4 w-4" />
                    Remove
                  </Button>
                ) : null}
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              PNG or JPEG up to 2 MB. The artwork fills the whole A4 page on every printed page —
              set the margins below so the invoice body stays clear of the artwork bands.
            </p>
          </div>

          <div className="grid gap-5 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="ei-top-mm">Top Margin (mm)</Label>
              <Input
                id="ei-top-mm"
                type="number"
                min={0}
                max={100}
                value={topMm}
                onChange={(e) => setTopMm(e.target.value)}
                disabled={!canEdit}
              />
              <p className="text-xs text-muted-foreground">
                Reserved height of the letterhead&apos;s top band. Without uploaded
                artwork the band prints with the striped placeholder zone from
                the approved template. Default 35.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="ei-bottom-mm">Bottom Margin (mm)</Label>
              <Input
                id="ei-bottom-mm"
                type="number"
                min={0}
                max={100}
                value={bottomMm}
                onChange={(e) => setBottomMm(e.target.value)}
                disabled={!canEdit}
              />
              <p className="text-xs text-muted-foreground">
                Reserved height of the bottom band. Without uploaded artwork the
                band prints with the striped placeholder zone. Default 22.
              </p>
            </div>
          </div>
          <p className="-mt-2 text-xs text-muted-foreground">
            The invoice body starts below the top margin and stops above the bottom one — it never
            overlaps the letterhead artwork. With no letterhead uploaded the
            striped placeholder zones mark the bands, and a typical invoice
            still fits ONE nicely-filled A4 page.
          </p>

          <div className="grid gap-5 sm:grid-cols-2">
            {imageUploadBlock(
              'signature',
              'Authorized Signature',
              'PNG with transparency recommended — printed above the signature line.',
              signatureInputRef,
              '',
              'No signature image'
            )}
            {imageUploadBlock(
              'stamp',
              'Company Stamp',
              'Printed inside the gold stamp circle on the invoice. Round artwork works best.',
              stampInputRef,
              'rounded-full',
              'No stamp image'
            )}
          </div>

          <div className="flex items-center justify-between rounded-lg border p-3">
            <div>
              <Label htmlFor="ei-receiver-default" className="text-sm">
                Show Receiver Signature by default
              </Label>
              <p className="mt-0.5 text-xs text-muted-foreground">
                New e-invoices start with the receiver signature line enabled (each invoice can
                override it).
              </p>
            </div>
            <Switch
              id="ei-receiver-default"
              checked={showReceiver}
              onCheckedChange={setShowReceiver}
              disabled={!canEdit}
            />
          </div>

          {/* Translation provider */}
          <div className="space-y-4 rounded-lg border p-4">
            <div className="flex items-center gap-1.5">
              <Languages className="h-4 w-4 text-[#8E6420]" />
              <p className="text-sm font-semibold">Arabic Auto-Translation</p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="ei-provider">Provider</Label>
                <Select value={provider} onValueChange={setProvider} disabled={!canEdit}>
                  <SelectTrigger id="ei-provider" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PROVIDER_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="ei-api-key">API Key</Label>
                  {cfg?.translateApiKeySet ? (
                    <Badge className="border-emerald-200 bg-emerald-50 font-medium text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300">
                      Key saved
                    </Badge>
                  ) : null}
                </div>
                <div className="flex gap-2">
                  <Input
                    id="ei-api-key"
                    type="password"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder={cfg?.translateApiKeySet ? 'Key saved — type to replace' : 'Not set'}
                    autoComplete="off"
                    disabled={!canEdit}
                  />
                  {cfg?.translateApiKeySet ? (
                    <Button
                      type="button"
                      variant="outline"
                      className="shrink-0"
                      onClick={() => void handleClearApiKey()}
                      disabled={!canEdit}
                    >
                      Clear
                    </Button>
                  ) : null}
                </div>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Falls back to manual Arabic entry if translation fails. The key is stored
              server-side only and never returned by the API.
            </p>
          </div>
        </div>
      )}

      <div className="mt-6 flex justify-end border-t pt-4">
        {canEdit ? (
          <Button onClick={() => void handleSave()} disabled={saving || loading}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Save Changes
          </Button>
        ) : (
          <Tooltip>
            <TooltipTrigger asChild>
              <span tabIndex={0} aria-disabled="true">
                <Button disabled tabIndex={-1}>
                  <Save className="h-4 w-4" />
                  Save Changes
                </Button>
              </span>
            </TooltipTrigger>
            <TooltipContent>You do not have permission to edit settings</TooltipContent>
          </Tooltip>
        )}
      </div>
    </SectionCard>
  )
}

export function GlossarySettingsSection() {
  const { user } = useAppStore()
  const canEdit = can(user, 'settings.edit')

  const [terms, setTerms] = useState<GlossaryTermRow[]>([])
  const [loading, setLoading] = useState(true)
  const [adding, setAdding] = useState(false)
  const [form, setForm] = useState({ termEn: '', termAr: '', notes: '' })

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await api.get<{ data: GlossaryTermRow[] }>('/api/glossary')
      setTerms(res.data)
    } catch {
      setTerms([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function handleAdd() {
    const termEn = form.termEn.trim()
    const termAr = form.termAr.trim()
    if (!termEn || !termAr) {
      toast.error('Both the English term and the Arabic translation are required')
      return
    }
    if (adding) return
    setAdding(true)
    try {
      const created = await api.post<GlossaryTermRow>('/api/glossary', {
        termEn,
        termAr,
        notes: form.notes.trim() || null,
      })
      setTerms((ts) => [...ts, created].sort((a, b) => a.termEn.localeCompare(b.termEn)))
      setForm({ termEn: '', termAr: '', notes: '' })
      toast.success(`Glossary term "${created.termEn}" added`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not add the glossary term')
    } finally {
      setAdding(false)
    }
  }

  async function handleDelete(term: GlossaryTermRow) {
    try {
      await api.del(`/api/glossary/${term.id}`)
      setTerms((ts) => ts.filter((t) => t.id !== term.id))
      toast.success(`Glossary term "${term.termEn}" removed`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not delete the glossary term')
    }
  }

  return (
    <SectionCard className="p-6">
      <h2 className="text-base font-semibold">Translation Glossary</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Fixed translations always applied before machine translation — exact matches and embedded
        phrases win over the provider, so company terminology stays consistent on every e-invoice.
      </p>

      <div className="mt-6 space-y-4">
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading glossary…
          </div>
        ) : terms.length === 0 ? (
          <div className="rounded-lg border border-dashed p-6 text-center">
            <Languages className="mx-auto h-6 w-6 text-muted-foreground" />
            <p className="mt-2 text-sm font-medium">No glossary terms yet</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Add the terms you use most — they will be translated exactly the same way every
              time.
            </p>
          </div>
        ) : (
          <div className="nice-scrollbar max-h-80 overflow-y-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50 hover:bg-muted/50">
                  <TableHead>English Term</TableHead>
                  <TableHead>
                    Arabic · <span lang="ar" dir="rtl">العربية</span>
                  </TableHead>
                  <TableHead className="hidden sm:table-cell">Notes</TableHead>
                  {canEdit ? <TableHead className="w-12" /> : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {terms.map((t) => (
                  <TableRow key={t.id}>
                    <TableCell className="font-medium">{t.termEn}</TableCell>
                    <TableCell lang="ar" dir="rtl" className="font-arabic">
                      {t.termAr}
                    </TableCell>
                    <TableCell className="hidden text-muted-foreground sm:table-cell">
                      {t.notes || '—'}
                    </TableCell>
                    {canEdit ? (
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                          onClick={() => void handleDelete(t)}
                          aria-label={`Delete glossary term ${t.termEn}`}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    ) : null}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        {/* Add form */}
        <div className="space-y-3 rounded-lg border bg-muted/30 p-4">
          <p className="flex items-center gap-1.5 text-sm font-semibold">
            <Lightbulb className="h-4 w-4 text-[#8E6420]" />
            Add a term
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="glossary-en">English Term</Label>
              <Input
                id="glossary-en"
                value={form.termEn}
                onChange={(e) => setForm((f) => ({ ...f, termEn: e.target.value }))}
                placeholder="e.g. Manpower Supply"
                disabled={!canEdit}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="glossary-ar">
                Arabic Translation · <span lang="ar" dir="rtl">العربية</span>
              </Label>
              <Input
                id="glossary-ar"
                lang="ar"
                dir="rtl"
                value={form.termAr}
                onChange={(e) => setForm((f) => ({ ...f, termAr: e.target.value }))}
                placeholder="مثال: توريد العمالة"
                className="font-arabic"
                disabled={!canEdit}
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="glossary-notes">Notes (optional)</Label>
              <Input
                id="glossary-notes"
                value={form.notes}
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                placeholder="e.g. Always use on client-facing invoices"
                disabled={!canEdit}
              />
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">
              Suggestions: Manpower Supply = <span lang="ar" dir="rtl">توريد العمالة</span> · Lump
              Sum = <span lang="ar" dir="rtl">مقطوعية</span> · Man-Month ={' '}
              <span lang="ar" dir="rtl">شهر/فرد</span>
            </p>
            {canEdit ? (
              <Button type="button" size="sm" onClick={() => void handleAdd()} disabled={adding}>
                {adding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                Add
              </Button>
            ) : null}
          </div>
        </div>
      </div>
    </SectionCard>
  )
}
