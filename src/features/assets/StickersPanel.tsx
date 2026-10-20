import { useState, type ChangeEvent } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useEditor } from '@/editor/store'
import { usePlayback } from '@/editor/playback'
import type { Asset } from '@/editor/types'
import { placeAsset } from '@/editor/placement'
import { desktop } from '@/lib/platform'
import { importMediaFiles } from '@/project/media-import'
import { assetThumb, PanelHeader, scrollArea, SectionLabel } from './shared'

const STARTER = [
  { id: 'wow', label: '¡WOW!', color: '#f7c948', shape: 'burst' },
  { id: 'lol', label: 'JAJA', color: '#a8e66b', shape: 'circle' },
  { id: 'love', label: 'TE QUIERO', color: '#ff7795', shape: 'heart' },
  { id: 'ok', label: 'TODO OK', color: '#75d4f4', shape: 'round' },
  { id: 'panic', label: '¡NOOO!', color: '#ff9b61', shape: 'burst' },
  { id: 'nice', label: 'BUENÍSIMO', color: '#c9a2ff', shape: 'round' },
]

function stickerSvg(label: string, color: string, shape: string) {
  const blob = shape === 'burst'
    ? '<path d="M256 28 296 74 360 48 374 112 438 112 426 176 484 208 446 256 484 304 426 336 438 400 374 400 360 464 296 438 256 484 216 438 152 464 138 400 74 400 86 336 28 304 66 256 28 208 86 176 74 112 138 112 152 48 216 74Z"/>'
    : shape === 'heart'
      ? '<path d="M256 438 76 270C-16 174 96 52 194 122l62 53 62-53c98-70 210 52 118 148Z"/>'
      : '<path d="M112 52h288a60 60 0 0 1 60 60v288a60 60 0 0 1-60 60H112a60 60 0 0 1-60-60V112a60 60 0 0 1 60-60Z"/>'
  return `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512"><g fill="${color}" stroke="#161616" stroke-width="20" stroke-linejoin="round">${blob}</g><text x="256" y="270" text-anchor="middle" dominant-baseline="middle" font-family="Arial,sans-serif" font-size="${label.length>8?48:64}" font-weight="900" fill="#171717" stroke="#fff" stroke-width="10" paint-order="stroke">${label}</text></svg>`
}

export function StickersPanel() {
  const [query, setQuery] = useState('')
  const assets = useEditor(useShallow((s) => Object.values(s.project.assets).filter((a) => a.kind === 'image'))) as Asset[]
  const stickers = assets.filter((a) => /sticker|meme|emoji/i.test(`${a.name} ${a.tags?.join(' ') ?? ''}`))
  const visible = STARTER.filter((s) => `${s.label} ${s.id}`.toLowerCase().includes(query.toLowerCase()))
  const importPack = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = [...(event.target.files ?? [])]
    event.target.value = ''
    if (!desktop || !files.length) return
    const saved = await Promise.all(files.filter((file) => /\.(png|jpe?g|webp|gif)$/i.test(file.name)).map(async (file) => {
      return desktop!.files.saveMedia('generated', `pack-${file.name}`, new Uint8Array(await file.arrayBuffer()))
    }))
    if (saved.length) await importMediaFiles(saved)
  }
  const addSticker = async (item: (typeof STARTER)[number]) => {
    const blob = new Blob([stickerSvg(item.label, item.color, item.shape)], { type: 'image/svg+xml' })
    const url = URL.createObjectURL(blob)
    const image = new Image()
    image.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = canvas.height = 512
      canvas.getContext('2d')!.drawImage(image, 0, 0)
      URL.revokeObjectURL(url)
      canvas.toBlob(async (png) => {
        if (!png || !desktop) return
        const saved = await desktop.files.saveMedia('generated', `faro-${item.id}.png`, new Uint8Array(await png.arrayBuffer()))
        const [asset] = await importMediaFiles([saved])
        if (asset) placeAsset(asset.id, usePlayback.getState().frame, { overlay: true, duration: Math.round(3 * useEditor.getState().project.settings.fps) })
      }, 'image/png')
    }
    image.src = url
  }

  return <>
    <PanelHeader title="Stickers & memes" />
    <div className={scrollArea}>
      <SectionLabel>Original Faro pack</SectionLabel>
      <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search stickers…" className="mb-3 w-full rounded-lg border border-line bg-black/20 px-2.5 py-2 text-xs outline-none placeholder:text-fg-4 focus:border-accent/60" />
      <div className="grid grid-cols-2 gap-2">
        {visible.map((item) => <button key={item.id} type="button" onClick={() => void addSticker(item)} className="rounded-xl border border-line bg-white/[0.025] p-2 text-center text-xs text-fg-2 hover:bg-white/[0.07]"><div className="mx-auto grid aspect-square max-w-24 place-items-center rounded-lg bg-[conic-gradient(from_90deg,#17191b_25%,#202226_0_50%,#17191b_0_75%,#202226_0)] bg-[length:18px_18px] text-2xl font-black" style={{ color: item.color, textShadow: '2px 2px #111,-2px -2px #fff' }}>{item.shape === 'heart' ? '♥' : item.label}</div><span className="mt-1.5 block">{item.label}</span></button>)}
      </div>
      <SectionLabel>Imported packs</SectionLabel>
      <p className="mb-2 text-2xs leading-relaxed text-fg-4">Import PNG, WebP or GIF stickers through Media. Tag their names or metadata with “sticker” or “meme” to find them here; keep the pack’s license and source with your files.</p>
      <label className="mb-3 inline-flex cursor-pointer rounded-lg border border-line bg-white/[0.04] px-2.5 py-2 text-xs text-fg-2 hover:bg-white/[0.08]">Import sticker images<input type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple className="sr-only" onChange={(event) => void importPack(event)} /></label>
      {stickers.length ? <div className="grid grid-cols-2 gap-2">{stickers.map((asset) => <button key={asset.id} type="button" onClick={() => placeAsset(asset.id, usePlayback.getState().frame, { overlay: true, duration: Math.round(3 * useEditor.getState().project.settings.fps) })} className="overflow-hidden rounded-lg border border-line bg-white/[0.03] text-left"><img src={assetThumb(asset)} alt="" className="aspect-square w-full object-contain"/><span className="block truncate px-2 py-1.5 text-xs">{asset.name}</span></button>)}</div> : <p className="text-xs text-fg-4">No imported sticker pack yet.</p>}
      <p className="mt-4 text-2xs text-fg-4">Stickers are separate 3-second clips at the playhead; trim them on the timeline. The starter pack is original vector art generated in Faro.</p>
    </div>
  </>
}

