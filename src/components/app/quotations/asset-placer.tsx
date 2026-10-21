'use client'

// AssetPlacer — drag & drop editor for the quotation's signature and stamp
// images on an A4 page (aspect 210:297). Positions/sizes are stored as
// PERCENTAGES of the page so the print/PDF output matches this preview
// exactly. Supports:
//   • upload (PNG/JPEG ≤ 2 MB, transparent PNG recommended)
//   • drag anywhere on the page (pointer events, touch friendly)
//   • resize via bottom-right scale handle AND a size slider (30%–200%)
//   • rotation slider (−180°…180°)
//   • show/hide each asset individually, per-asset remove
// The parent owns the state — this component is fully controlled.
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Grip,
  ImagePlus,
  PenLine,
  RotateCw,
  ScanEye,
  Stamp,
  Trash2,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'
import { fileToDataUrl, formatImageSize } from '@/lib/image-data-url'
import type { QuotationAssetRow } from '@/lib/types'

export type AssetType = 'signature' | 'stamp'

/** Default placement: signature above "Authorized Signatory", stamp left of it. */
export function defaultAssetPlacement(type: AssetType, dataUrl: string): QuotationAssetRow {
  return type === 'signature'
    ? { type, dataUrl, posX: 68, posY: 83, width: 20, rotation: 0, visible: true }
    : { type, dataUrl, posX: 44, posY: 78, width: 17, rotation: -12, visible: true }
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

type DragState =
  | { kind: 'move'; type: AssetType; startX: number; startY: number; origX: number; origY: number }
  | { kind: 'resize'; type: AssetType; startX: number; origW: number }
  | null

export function AssetPlacer({
  assets,
  onChange,
  disabled = false,
  onError,
}: {
  assets: QuotationAssetRow[]
  onChange: (next: QuotationAssetRow[]) => void
  disabled?: boolean
  onError?: (message: string) => void
}) {
  const [selected, setSelected] = useState<AssetType>('signature')
  const [uploading, setUploading] = useState<AssetType | null>(null)
  const pageRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<DragState>(null)
  const sigFileRef = useRef<HTMLInputElement>(null)
  const stampFileRef = useRef<HTMLInputElement>(null)

  const signature = assets.find((a) => a.type === 'signature') ?? null
  const stamp = assets.find((a) => a.type === 'stamp') ?? null
  const activeAsset = selected === 'signature' ? signature : stamp

  const patch = useCallback(
    (type: AssetType, changes: Partial<QuotationAssetRow>) => {
      onChange(
        assets.map((a) => (a.type === type ? { ...a, ...changes } : a))
      )
    },
    [assets, onChange]
  )

  // ── upload handling ──────────────────────────────────────────────────────
  // Upload errors are surfaced to the parent via the onError callback.
  function safeUpload(type: AssetType, file: File | undefined) {
    if (!file) return
    setUploading(type)
    fileToDataUrl(file)
      .then((dataUrl) => {
        const existing = assets.find((a) => a.type === type)
        if (existing) {
          // keep the current placement when replacing the artwork
          patch(type, { dataUrl, visible: true })
        } else {
          onChange([...assets, defaultAssetPlacement(type, dataUrl)])
        }
        setSelected(type)
      })
      .catch((e: unknown) => {
        onError?.(e instanceof Error ? e.message : 'Upload failed')
      })
      .finally(() => setUploading(null))
  }

  // ── pointer drag: move + resize ──────────────────────────────────────────
  useEffect(() => {
    function onMove(e: PointerEvent) {
      const d = dragRef.current
      const page = pageRef.current
      if (!d || !page) return
      const rect = page.getBoundingClientRect()
      if (d.kind === 'move') {
        const dx = ((e.clientX - d.startX) / rect.width) * 100
        const dy = ((e.clientY - d.startY) / rect.height) * 100
        patch(d.type, {
          posX: clamp(d.origX + dx, -4, 98),
          posY: clamp(d.origY + dy, -4, 98),
        })
      } else {
        const dx = ((e.clientX - d.startX) / rect.width) * 100
        patch(d.type, { width: clamp(d.origW + dx, 4, 70) })
      }
    }
    function onUp() {
      dragRef.current = null
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
  }, [patch])

  function startMove(e: React.PointerEvent, a: QuotationAssetRow) {
    if (disabled || !a.visible) return
    e.preventDefault()
    setSelected(a.type)
    dragRef.current = {
      kind: 'move',
      type: a.type,
      startX: e.clientX,
      startY: e.clientY,
      origX: a.posX,
      origY: a.posY,
    }
  }

  function startResize(e: React.PointerEvent, a: QuotationAssetRow) {
    if (disabled) return
    e.preventDefault()
    e.stopPropagation()
    setSelected(a.type)
    dragRef.current = { kind: 'resize', type: a.type, startX: e.clientX, origW: a.width }
  }

  const sizeLabel = activeAsset ? Math.round(activeAsset.width) : 0

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_260px]">
      {/* ── A4 page canvas ── */}
      <div
        ref={pageRef}
        className="relative mx-auto w-full max-w-[420px] select-none overflow-hidden rounded-lg border-2 border-dashed border-neutral-300 bg-[repeating-linear-gradient(0deg,transparent,transparent_23px,rgba(0,0,0,0.03)_24px),repeating-linear-gradient(90deg,transparent,transparent_23px,rgba(0,0,0,0.03)_24px)] shadow-inner dark:border-neutral-700"
        style={{ aspectRatio: '210 / 297' }}
        onPointerDown={() => {
          if (!disabled) setSelected('signature')
        }}
      >
        {/* faint signature-area hint */}
        <div className="pointer-events-none absolute bottom-[9%] right-[6%] w-[46%] text-center">
          <div className="border-t border-neutral-400/70 pt-1 text-[9px] font-semibold uppercase tracking-widest text-neutral-400">
            Authorized Signatory
          </div>
        </div>
        <div className="pointer-events-none absolute bottom-[9%] left-[6%] w-[30%] text-center">
          <div className="border-t border-neutral-400/40 pt-1 text-[9px] font-semibold uppercase tracking-widest text-neutral-400">
            Client Acceptance
          </div>
        </div>

        {(disabled ? [] : [signature, stamp]).map((a) => {
          if (!a) return null
          const isActive = selected === a.type
          return (
            <div
              key={a.type}
              role="button"
              tabIndex={0}
              aria-label={`${a.type} placement`}
              className={cn(
                'absolute cursor-grab touch-none outline-none active:cursor-grabbing',
                !a.visible && 'opacity-30 saturate-0',
                isActive && 'z-10 ring-2 ring-emerald-500 ring-offset-1',
                disabled && 'cursor-default'
              )}
              style={{
                left: `${a.posX}%`,
                top: `${a.posY}%`,
                width: `${a.width}%`,
                transform: `rotate(${a.rotation}deg)`,
                transformOrigin: 'center',
              }}
              onPointerDown={(e) => startMove(e, a)}
              onKeyDown={(e) => {
                // keyboard nudge — 0.5% per press, shift = 2%
                const step = e.shiftKey ? 2 : 0.5
                if (e.key === 'ArrowLeft') { e.preventDefault(); patch(a.type, { posX: clamp(a.posX - step, -4, 98) }) }
                if (e.key === 'ArrowRight') { e.preventDefault(); patch(a.type, { posX: clamp(a.posX + step, -4, 98) }) }
                if (e.key === 'ArrowUp') { e.preventDefault(); patch(a.type, { posY: clamp(a.posY - step, -4, 98) }) }
                if (e.key === 'ArrowDown') { e.preventDefault(); patch(a.type, { posY: clamp(a.posY + step, -4, 98) }) }
              }}
            >
              <img
                src={a.dataUrl}
                alt={`${a.type} preview`}
                draggable={false}
                className="pointer-events-none block w-full"
              />
              {/* resize handle */}
              <span
                role="button"
                tabIndex={-1}
                aria-label={`Resize ${a.type}`}
                className="absolute -bottom-1.5 -right-1.5 flex h-4 w-4 items-center justify-center rounded-sm border border-white bg-emerald-600 text-white shadow"
                onPointerDown={(e) => startResize(e, a)}
              >
                <svg viewBox="0 0 10 10" className="h-2.5 w-2.5 fill-current">
                  <path d="M9 1v8H1L9 1z" />
                </svg>
              </span>
            </div>
          )
        })}

        {/* empty state hint */}
        {!signature && !stamp && !disabled ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 p-6 text-center text-neutral-400">
            <ImagePlus className="h-8 w-8 opacity-60" />
            <p className="text-xs font-medium">
              Upload a signature and a company stamp, then drag them into place
            </p>
            <p className="text-[10px]">PNG with transparent background works best</p>
          </div>
        ) : null}
      </div>

      {/* ── controls ── */}
      <div className="flex flex-col gap-3">
        <div className="grid grid-cols-2 gap-2">
          <AssetSlot
            label="Signature"
            icon={<PenLine className="h-3.5 w-3.5" />}
            asset={signature}
            uploading={uploading === 'signature'}
            disabled={disabled}
            selected={selected === 'signature'}
            onSelect={() => setSelected('signature')}
            onPick={() => sigFileRef.current?.click()}
            onToggle={(v) => signature && patch('signature', { visible: v })}
            onRemove={() => onChange(assets.filter((a) => a.type !== 'signature'))}
          />
          <AssetSlot
            label="Stamp"
            icon={<Stamp className="h-3.5 w-3.5" />}
            asset={stamp}
            uploading={uploading === 'stamp'}
            disabled={disabled}
            selected={selected === 'stamp'}
            onSelect={() => setSelected('stamp')}
            onPick={() => stampFileRef.current?.click()}
            onToggle={(v) => stamp && patch('stamp', { visible: v })}
            onRemove={() => onChange(assets.filter((a) => a.type !== 'stamp'))}
          />
        </div>

        <input
          ref={sigFileRef}
          type="file"
          accept="image/png,image/jpeg"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0]
            e.target.value = ''
            safeUpload('signature', f)
          }}
        />
        <input
          ref={stampFileRef}
          type="file"
          accept="image/png,image/jpeg"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0]
            e.target.value = ''
            safeUpload('stamp', f)
          }}
        />

        {activeAsset ? (
          <div className="space-y-3 rounded-lg border bg-muted/40 p-3">
            <div className="flex items-center justify-between">
              <p className="flex items-center gap-1.5 text-xs font-semibold capitalize">
                <Grip className="h-3.5 w-3.5" />
                {activeAsset.type} placement
              </p>
              <span className="rounded bg-background px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-muted-foreground">
                {formatImageSize(Math.round((activeAsset.dataUrl.length * 3) / 4))}
              </span>
            </div>

            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <Label className="text-[11px]">
                  Size <span className="text-muted-foreground">(width {sizeLabel}% of page)</span>
                </Label>
                <span className="text-[10px] tabular-nums text-muted-foreground">30–200%</span>
              </div>
              <Slider
                value={[Math.round((activeAsset.width / 30) * 100)]}
                min={30}
                max={200}
                step={5}
                disabled={disabled}
                onValueChange={(v) =>
                  patch(activeAsset.type, { width: clamp((v[0] / 100) * 30, 4, 70) })
                }
              />
            </div>

            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <Label className="flex items-center gap-1 text-[11px]">
                  <RotateCw className="h-3 w-3" /> Rotation
                </Label>
                <span className="text-[10px] tabular-nums text-muted-foreground">
                  {Math.round(activeAsset.rotation)}°
                </span>
              </div>
              <Slider
                value={[activeAsset.rotation]}
                min={-180}
                max={180}
                step={1}
                disabled={disabled}
                onValueChange={(v) => patch(activeAsset.type, { rotation: v[0] })}
              />
            </div>

            <div className="grid grid-cols-3 gap-2">
              <div>
                <Label className="text-[10px] text-muted-foreground">X %</Label>
                <Input
                  type="number"
                  step="0.5"
                  value={activeAsset.posX}
                  disabled={disabled}
                  className="h-8 text-xs tabular-nums"
                  onChange={(e) =>
                    patch(activeAsset.type, { posX: clamp(parseFloat(e.target.value) || 0, -4, 98) })
                  }
                />
              </div>
              <div>
                <Label className="text-[10px] text-muted-foreground">Y %</Label>
                <Input
                  type="number"
                  step="0.5"
                  value={activeAsset.posY}
                  disabled={disabled}
                  className="h-8 text-xs tabular-nums"
                  onChange={(e) =>
                    patch(activeAsset.type, { posY: clamp(parseFloat(e.target.value) || 0, -4, 98) })
                  }
                />
              </div>
              <div>
                <Label className="text-[10px] text-muted-foreground">W %</Label>
                <Input
                  type="number"
                  step="0.5"
                  value={activeAsset.width}
                  disabled={disabled}
                  className="h-8 text-xs tabular-nums"
                  onChange={(e) =>
                    patch(activeAsset.type, { width: clamp(parseFloat(e.target.value) || 4, 4, 70) })
                  }
                />
              </div>
            </div>

            <p className="text-[10px] leading-relaxed text-muted-foreground">
              Drag on the page to move · drag the green corner to scale · arrow keys nudge (hold
              Shift for bigger steps). Placement is saved with the quotation and reproduced exactly
              in the printed PDF.
            </p>
          </div>
        ) : (
          <div className="flex items-start gap-2 rounded-lg border border-dashed p-3 text-[11px] text-muted-foreground">
            <ScanEye className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            Upload a signature or stamp to unlock placement controls.
          </div>
        )}
      </div>
    </div>
  )
}

function AssetSlot({
  label,
  icon,
  asset,
  uploading,
  disabled,
  selected,
  onSelect,
  onPick,
  onToggle,
  onRemove,
}: {
  label: string
  icon: React.ReactNode
  asset: QuotationAssetRow | null
  uploading: boolean
  disabled: boolean
  selected: boolean
  onSelect: () => void
  onPick: () => void
  onToggle: (v: boolean) => void
  onRemove: () => void
}) {
  return (
    <div
      className={cn(
        'flex flex-col gap-2 rounded-lg border p-2.5 transition-colors',
        selected && asset ? 'border-emerald-500/60 bg-emerald-50/50 dark:bg-emerald-950/20' : 'bg-card'
      )}
      onClick={onSelect}
    >
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1 text-[11px] font-semibold">
          {icon}
          {label}
        </span>
        {asset ? (
          <Switch
            checked={asset.visible}
            disabled={disabled}
            onCheckedChange={onToggle}
            aria-label={`Show ${label}`}
            className="scale-90"
          />
        ) : null}
      </div>
      <div className="flex h-14 items-center justify-center overflow-hidden rounded border border-dashed bg-background">
        {asset ? (
          <img
            src={asset.dataUrl}
            alt={`${label} thumbnail`}
            className={cn('max-h-full max-w-full object-contain', !asset.visible && 'opacity-30 saturate-0')}
          />
        ) : (
          <span className="text-[10px] text-muted-foreground">Not uploaded</span>
        )}
      </div>
      <div className="flex gap-1.5">
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-7 flex-1 px-2 text-[11px]"
          disabled={disabled || uploading}
          onClick={(e) => {
            e.stopPropagation()
            onPick()
          }}
        >
          <ImagePlus className="mr-1 h-3 w-3" />
          {uploading ? 'Reading…' : asset ? 'Replace' : 'Upload'}
        </Button>
        {asset ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-7 w-7 shrink-0 p-0 text-rose-600 hover:bg-rose-50 hover:text-rose-700 dark:hover:bg-rose-950"
            disabled={disabled}
            onClick={(e) => {
              e.stopPropagation()
              onRemove()
            }}
            aria-label={`Remove ${label}`}
          >
            <Trash2 className="h-3 w-3" />
          </Button>
        ) : null}
      </div>
    </div>
  )
}
