import { Check, FileUp, Trash2 } from 'lucide-react'
import { useRef } from 'react'
import { toast } from 'sonner'
import { applyLook } from '@/editor/placement'
import { parseCube } from '@/editor/lut'
import { LOOKS, type Look } from '@/editor/presets'
import { usePlayback } from '@/editor/playback'
import type { Asset, ColorGrade } from '@/editor/types'
import { dispatch, useEditor } from '@/editor/store'
import { useUI } from '@/editor/ui-store'
import { gradeFilter, gradeOverlays } from '@/engine/color'
import { clipSourceTime } from '@/engine/compositor'
import { usePreviewArt } from '@/engine/preview-art'
import { dnd } from '@/features/dnd'
import { cn } from '@/lib/cn'
import { Button } from '@/components/ui/button'
import { assetThumb, PanelHeader, scrollArea, SectionLabel } from './shared'

const EMPTY_LUTS: NonNullable<ReturnType<typeof useEditor.getState>['project']['luts']> = {}

/** The same grade pipeline the compositor uses, expressed as CSS. */
export function GradedImage({ src, grade, className }: { src?: string; grade: ColorGrade; className?: string }) {
  return (
    <div className={cn('relative overflow-hidden bg-black', className)}>
      {src && <img src={src} alt="" draggable={false} className="h-full w-full object-cover" style={{ filter: gradeFilter(grade) }} />}
      {gradeOverlays(grade).map((o, i) => (
        <div key={i} className="absolute inset-0 mix-blend-soft-light" style={{ background: o.color, opacity: o.alpha }} />
      ))}
      {grade.vignette > 0 && (
        <div className="absolute inset-0" style={{ background: `radial-gradient(ellipse at center, transparent 40%, rgba(0,0,0,${(0.85 * grade.vignette) / 100}))` }} />
      )}
    </div>
  )
}

export function LooksPanel() {
  const selection = useUI((s) => s.selection)
  const clip = useEditor((s) => (selection.length ? s.project.clips[selection[0]] : undefined))
  const asset = useEditor((s) => (clip?.assetId ? s.project.assets[clip.assetId] : undefined)) as Asset | undefined
  // Previews follow the playhead while paused; during playback they hold (ten graded images per frame is a lot).
  const frame = usePlayback((s) => s.pausedFrame)
  const fps = useEditor((s) => s.project.settings.fps)
  const projectLuts = useEditor((s) => s.project.luts)
  const luts = projectLuts ?? EMPTY_LUTS
  const art = usePreviewArt()

  const visual = clip && (clip.kind === 'video' || clip.kind === 'image') && asset
  const t = visual ? Math.max(0, clipSourceTime(clip, Math.max(0, Math.min(clip.duration - 1, frame - clip.start)), fps)) : 0
  const src = (visual ? assetThumb(asset, Math.round(t * 2) / 2) : undefined) ?? art.a

  return (
    <>
      <PanelHeader title="Looks" />
      <div className={scrollArea}>
        <div className="mb-3 flex items-center justify-between gap-2 rounded-lg bg-white/[0.035] p-2.5">
          <div className="min-w-0"><div className="text-xs font-medium text-fg-2">3D LUTs</div><div className="text-2xs text-fg-4">Import .cube files and apply them in Color controls</div></div>
          <LutImportButton />
        </div>
        {Object.keys(luts).length > 0 && <div className="mb-3 space-y-1">
          {Object.values(luts).map((lut) => <div key={lut.id} className="flex items-center gap-2 rounded-md bg-black/15 px-2 py-1.5 text-xs"><span className="min-w-0 flex-1 truncate text-fg-2">{lut.name}</span><button type="button" aria-label={`Remove ${lut.name}`} title={`Remove ${lut.name}`} onClick={() => { const res = dispatch('lut.remove', { id: lut.id }); if (!res.ok) toast.error(res.error) }} className="grid size-6 place-items-center rounded text-fg-4 hover:bg-white/[0.08] hover:text-fg"><Trash2 className="size-3.5" /></button></div>)}
        </div>}
        <SectionLabel right={<span className="max-w-[140px] truncate text-2xs text-fg-4">{visual ? `Previewing ${clip.name}` : 'Select a clip'}</span>}>Color looks</SectionLabel>
        <div className="grid grid-cols-2 gap-x-2.5 gap-y-3">
          {LOOKS.map((look) => (
            <LookCard key={look.id} look={look} src={src} active={clip?.look === look.id} />
          ))}
        </div>
        <p className="mt-4 px-1 text-2xs leading-relaxed text-fg-4">Looks set the clip’s color controls — fine-tune them anytime in the inspector’s Color tab.</p>
      </div>
    </>
  )
}

function LutImportButton() {
  const input = useRef<HTMLInputElement>(null)
  const importFile = async (file: File) => {
    try {
      const parsed = parseCube(await file.text())
      const id = `lut_${crypto.randomUUID()}`
      const name = parsed.title || file.name.replace(/\.cube$/i, '')
      const data = btoa(Array.from(parsed.data, (b) => String.fromCharCode(b)).join(''))
      const res = dispatch('lut.add', { lut: { id, name, size: parsed.size, data } })
      if (!res.ok) throw new Error(res.error)
      toast.success(`Imported ${name}`, { description: `${parsed.size}-point 3D LUT · select a clip, then choose it in Inspector → Color.` })
    } catch (err) {
      toast.error(`Couldn’t import ${file.name}`, { description: err instanceof Error ? err.message : String(err) })
    }
  }
  return <>
    <input ref={input} className="hidden" type="file" accept=".cube,text/plain" onChange={(e) => { const file = e.currentTarget.files?.[0]; if (file) void importFile(file); e.currentTarget.value = '' }} />
    <Button size="sm" variant="secondary" onClick={() => input.current?.click()}><FileUp />Import LUT</Button>
  </>
}

function LookCard({ look, src, active }: { look: Look; src?: string; active: boolean }) {
  return (
    <button
      type="button"
      draggable
      onDragStart={(e) => dnd.start(e, { type: 'look', lookId: look.id }, look.name)}
      onDragEnd={dnd.end}
      onClick={() => applyLook(look.id, useUI.getState().selection)}
      className="group/look text-left outline-none"
    >
      <div
        className={cn(
          'relative overflow-hidden rounded-[10px] shadow-[inset_0_0_0_1px_rgb(255_255_255/0.06)] transition-shadow duration-200 group-hover/look:shadow-[0_0_0_1px_rgb(255_255_255/0.18),0_10px_24px_-10px_rgb(0_0_0/0.9)]',
          active && 'shadow-[0_0_0_2px_var(--color-accent),0_0_0_5px_rgb(214_238_0/0.2)]',
        )}
      >
        <GradedImage src={src} grade={look.grade} className="aspect-video transition-transform duration-500 group-hover/look:scale-[1.03]" />
        {active && (
          <span className="absolute top-1.5 right-1.5 grid size-5 place-items-center rounded-full bg-accent text-accent-fg shadow">
            <Check className="size-3" strokeWidth={3} />
          </span>
        )}
      </div>
      <div className={cn('mt-1.5 px-0.5 text-xs font-medium', active ? 'text-accent-2' : 'text-fg-2 group-hover/look:text-fg')}>{look.name}</div>
    </button>
  )
}
