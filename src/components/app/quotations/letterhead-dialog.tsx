'use client'

// LetterheadDialog — company A4 letterhead manager for business documents.
//   • mode: none (styled text header) | header | header_footer | full page
//   • upload / replace / clear header, footer and full-page artwork
//     (PNG/JPEG ≤ 2 MB, magic-byte validated server-side too)
//   • reserved top/bottom bands in mm so document content never overlaps
//   • toggle the textual company-details block (for artwork that already
//     carries the company identity)
//   • live mini A4 preview of the arrangement
// Saved via PUT /api/letterhead; every A4 quotation picks it up immediately.
import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { ImageUp, Layers, Loader2, Save, Trash2 } from 'lucide-react'

import { api } from '@/lib/api-client'
import { fileToDataUrl, formatImageSize } from '@/lib/image-data-url'
import type { LetterheadConfig } from '@/lib/types'
import { cn } from '@/lib/utils'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

const MODES: Array<{ value: LetterheadConfig['mode']; label: string; hint: string }> = [
  { value: 'none', label: 'Styled header', hint: 'Default typed company header (logo + details)' },
  { value: 'header', label: 'Header image', hint: 'Your artwork repeats at the top of every page' },
  { value: 'header_footer', label: 'Header + footer', hint: 'Artwork bands at top and bottom of every page' },
  { value: 'full', label: 'Full-page design', hint: 'Complete A4 background on every page' },
]

const DEFAULT_CONFIG: LetterheadConfig = {
  mode: 'none',
  headerImage: null,
  footerImage: null,
  fullPageImage: null,
  showCompanyDetails: true,
  headerHeightMm: 30,
  footerHeightMm: 18,
}

export function LetterheadDialog({
  open,
  onOpenChange,
  onSaved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved?: (config: LetterheadConfig) => void
}) {
  const [config, setConfig] = useState<LetterheadConfig>(DEFAULT_CONFIG)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const headerFileRef = useRef<HTMLInputElement>(null)
  const footerFileRef = useRef<HTMLInputElement>(null)
  const fullFileRef = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await api.get<LetterheadConfig>('/api/letterhead')
      setConfig({ ...DEFAULT_CONFIG, ...res })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not load the letterhead settings')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (open) void load()
  }, [open, load])

  function pickImage(slot: 'headerImage' | 'footerImage' | 'fullPageImage') {
    return (file: File | undefined) => {
      if (!file) return
      fileToDataUrl(file)
        .then((dataUrl) => setConfig((c) => ({ ...c, [slot]: dataUrl })))
        .catch((e: unknown) =>
          toast.error(e instanceof Error ? e.message : 'Could not read the image')
        )
    }
  }

  async function handleSave() {
    // client-side guard — the API re-validates everything
    if (config.mode !== 'none') {
      const needed = config.mode === 'full' ? config.fullPageImage : config.headerImage
      if (!needed) {
        toast.error(
          config.mode === 'full'
            ? 'Upload the full-page artwork before enabling full-page mode'
            : 'Upload the header artwork before enabling header mode'
        )
        return
      }
    }
    setSaving(true)
    try {
      const saved = await api.put<LetterheadConfig>('/api/letterhead', config)
      setConfig({ ...DEFAULT_CONFIG, ...saved })
      onSaved?.(saved)
      toast.success('Letterhead saved — new quotations use it immediately')
      onOpenChange(false)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save the letterhead')
    } finally {
      setSaving(false)
    }
  }

  const mmToPct = (mm: number) => (mm / 297) * 100

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] w-full overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Layers className="h-5 w-5 text-emerald-600" />
            Company Letterhead — A4
          </DialogTitle>
          <DialogDescription>
            Design reused by every printed quotation. Upload artwork sized for A4 (210 × 297 mm);
            PNG or JPEG up to 2 MB per image.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading letterhead settings…
          </div>
        ) : (
          <div className="grid gap-5 md:grid-cols-[1fr_240px]">
            {/* ── settings column ── */}
            <div className="space-y-5">
              <div className="space-y-2">
                <Label className="text-xs font-semibold">Letterhead mode</Label>
                <Select
                  value={config.mode}
                  onValueChange={(v) => setConfig((c) => ({ ...c, mode: v as LetterheadConfig['mode'] }))}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Choose a mode" />
                  </SelectTrigger>
                  <SelectContent>
                    {MODES.map((m) => (
                      <SelectItem key={m.value} value={m.value}>
                        <div className="flex flex-col">
                          <span className="font-medium">{m.label}</span>
                          <span className="text-xs text-muted-foreground">{m.hint}</span>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                <ImageSlot
                  label="Header artwork"
                  hint="top band of every page"
                  dataUrl={config.headerImage}
                  onPick={() => headerFileRef.current?.click()}
                  onClear={() => setConfig((c) => ({ ...c, headerImage: null }))}
                />
                <ImageSlot
                  label="Footer artwork"
                  hint="bottom band of every page"
                  dataUrl={config.footerImage}
                  onPick={() => footerFileRef.current?.click()}
                  onClear={() => setConfig((c) => ({ ...c, footerImage: null }))}
                />
                <ImageSlot
                  label="Full-page design"
                  hint="complete A4 background"
                  dataUrl={config.fullPageImage}
                  onPick={() => fullFileRef.current?.click()}
                  onClear={() => setConfig((c) => ({ ...c, fullPageImage: null }))}
                />
              </div>
              <input
                ref={headerFileRef}
                type="file"
                accept="image/png,image/jpeg"
                className="hidden"
                onChange={(e) => {
                  pickImage('headerImage')(e.target.files?.[0])
                  e.target.value = ''
                }}
              />
              <input
                ref={footerFileRef}
                type="file"
                accept="image/png,image/jpeg"
                className="hidden"
                onChange={(e) => {
                  pickImage('footerImage')(e.target.files?.[0])
                  e.target.value = ''
                }}
              />
              <input
                ref={fullFileRef}
                type="file"
                accept="image/png,image/jpeg"
                className="hidden"
                onChange={(e) => {
                  pickImage('fullPageImage')(e.target.files?.[0])
                  e.target.value = ''
                }}
              />

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2 rounded-lg border p-3">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs font-semibold">Top reserved band</Label>
                    <span className="text-xs tabular-nums text-muted-foreground">
                      {config.headerHeightMm} mm
                    </span>
                  </div>
                  <Slider
                    value={[config.headerHeightMm]}
                    min={10}
                    max={90}
                    step={1}
                    onValueChange={(v) => setConfig((c) => ({ ...c, headerHeightMm: v[0] }))}
                  />
                  <p className="text-[10px] text-muted-foreground">
                    Content starts below this band so it never overlaps your header artwork.
                  </p>
                </div>
                <div className="space-y-2 rounded-lg border p-3">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs font-semibold">Bottom reserved band</Label>
                    <span className="text-xs tabular-nums text-muted-foreground">
                      {config.footerHeightMm} mm
                    </span>
                  </div>
                  <Slider
                    value={[config.footerHeightMm]}
                    min={8}
                    max={60}
                    step={1}
                    onValueChange={(v) => setConfig((c) => ({ ...c, footerHeightMm: v[0] }))}
                  />
                  <p className="text-[10px] text-muted-foreground">
                    Content stops above this band (also hosts the page number strip).
                  </p>
                </div>
              </div>

              <div className="flex items-center justify-between rounded-lg border p-3">
                <div>
                  <Label className="text-xs font-semibold">Show typed company details</Label>
                  <p className="text-[10px] text-muted-foreground">
                    Turn off when your artwork already carries the company name, logo and contacts.
                  </p>
                </div>
                <Switch
                  checked={config.showCompanyDetails}
                  onCheckedChange={(v) => setConfig((c) => ({ ...c, showCompanyDetails: v }))}
                  aria-label="Show typed company details"
                />
              </div>
            </div>

            {/* ── mini A4 preview ── */}
            <div className="space-y-2">
              <Label className="text-xs font-semibold">Preview</Label>
              <div
                className="relative w-full overflow-hidden rounded border bg-white text-[7px] shadow"
                style={{ aspectRatio: '210 / 297' }}
              >
                {config.mode === 'full' && config.fullPageImage ? (
                  <img
                    src={config.fullPageImage}
                    alt="Full-page letterhead preview"
                    className="absolute inset-0 h-full w-full object-fill"
                  />
                ) : null}
                {config.mode !== 'none' && config.mode !== 'full' && config.headerImage ? (
                  <img
                    src={config.headerImage}
                    alt="Header preview"
                    className="absolute left-0 top-0 w-full object-fill"
                    style={{ height: `${mmToPct(config.headerHeightMm)}%` }}
                  />
                ) : null}
                {config.mode === 'header_footer' && config.footerImage ? (
                  <img
                    src={config.footerImage}
                    alt="Footer preview"
                    className="absolute bottom-0 left-0 w-full object-fill"
                    style={{ height: `${mmToPct(config.footerHeightMm)}%` }}
                  />
                ) : null}
                {config.mode === 'none' ? (
                  <div className="absolute left-0 top-0 w-full border-b border-neutral-300 px-2 py-1">
                    <div className="flex items-center justify-between">
                      <span className="font-bold uppercase tracking-wide text-neutral-800">
                        Company header
                      </span>
                      <span className="rounded bg-neutral-800 px-1 py-0.5 text-[6px] font-bold tracking-widest text-white">
                        QUOTATION
                      </span>
                    </div>
                    {config.showCompanyDetails ? (
                      <div className="mt-0.5 text-[6px] text-neutral-500">
                        address · tel · email · VAT
                      </div>
                    ) : null}
                  </div>
                ) : null}
                {/* content-safe zone indicator */}
                <div
                  className="absolute left-[6%] right-[6%] border border-dashed border-emerald-400/70 bg-emerald-50/40"
                  style={{
                    top: `calc(${config.mode === 'full' ? mmToPct(Math.max(config.headerHeightMm, 25)) : config.mode === 'none' ? 12 : mmToPct(config.headerHeightMm)}% + 4px)`,
                    bottom: `calc(${config.mode === 'none' ? 8 : mmToPct(config.footerHeightMm)}% + 4px)`,
                  }}
                >
                  <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-[7px] font-medium text-emerald-600">
                    content area
                  </span>
                </div>
              </div>
              <p className="text-[10px] leading-relaxed text-muted-foreground">
                {MODES.find((m) => m.value === config.mode)?.hint}
              </p>
            </div>
          </div>
        )}

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={() => void handleSave()} disabled={saving || loading}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Save Letterhead
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ImageSlot({
  label,
  hint,
  dataUrl,
  onPick,
  onClear,
}: {
  label: string
  hint: string
  dataUrl: string | null
  onPick: () => void
  onClear: () => void
}) {
  return (
    <div className="flex flex-col gap-1.5 rounded-lg border p-2.5">
      <div>
        <p className="text-[11px] font-semibold">{label}</p>
        <p className="text-[10px] text-muted-foreground">{hint}</p>
      </div>
      <div className="flex h-16 items-center justify-center overflow-hidden rounded border border-dashed bg-muted/30">
        {dataUrl ? (
          <img src={dataUrl} alt={`${label} preview`} className="max-h-full max-w-full object-contain" />
        ) : (
          <span className="text-[10px] text-muted-foreground">No image</span>
        )}
      </div>
      <div className="flex items-center gap-1.5">
        <Button type="button" size="sm" variant="outline" className="h-7 flex-1 px-2 text-[11px]" onClick={onPick}>
          <ImageUp className="mr-1 h-3 w-3" />
          {dataUrl ? 'Replace' : 'Upload'}
        </Button>
        {dataUrl ? (
          <>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7 w-7 p-0 text-rose-600 hover:bg-rose-50 hover:text-rose-700 dark:hover:bg-rose-950"
              onClick={onClear}
              aria-label={`Clear ${label}`}
            >
              <Trash2 className="h-3 w-3" />
            </Button>
            <span className={cn('text-[9px] tabular-nums text-muted-foreground')}>
              {formatImageSize(Math.round((dataUrl.length * 3) / 4))}
            </span>
          </>
        ) : null}
      </div>
    </div>
  )
}
