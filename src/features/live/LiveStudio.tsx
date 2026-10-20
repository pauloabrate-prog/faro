import { AudioLines, Camera, CircleStop, FileImage, FilePlus2, ImagePlus, Loader2, Radio, RefreshCw, Video, Volume2, VolumeX, X } from 'lucide-react'
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { toast } from 'sonner'
import { Button, IconButton } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Row } from '@/components/ui/section'
import { Select } from '@/components/ui/select'
import { Tip } from '@/components/ui/tooltip'
import { useEditor } from '@/editor/store'
import { useLiveStudio, LiveProgram, type LiveImage, type LiveLook, type LiveSound, type LiveTransition } from './live-studio'
import { cn } from '@/lib/cn'
import { desktop } from '@/lib/platform'

type Device = { id: string; label: string }
type CameraState = { stream: MediaStream | null; error: string | null }
type CameraFeed = { id: string; stream: MediaStream; level: number }
type MicChannel = { id: string; level: number; muted: boolean }
const EMPTY_MICS: MicChannel[] = Array.from({ length: 3 }, () => ({ id: '', level: 100, muted: false }))
const LOOK_FILTER: Record<LiveLook, string> = { clean: 'none', cinema: 'contrast(1.14) saturate(.88)', warm: 'sepia(.16) saturate(1.12)', mono: 'grayscale(1) contrast(1.08)' }

function useDevices(open: boolean) {
  const [cameras, setCameras] = useState<Device[]>([])
  const [microphones, setMicrophones] = useState<Device[]>([])
  const refresh = async () => {
    try {
      const all = await navigator.mediaDevices.enumerateDevices()
      setCameras(all.filter((d) => d.kind === 'videoinput' && d.deviceId).map((d, i) => ({ id: d.deviceId, label: d.label || `Camera ${i + 1}` })))
      setMicrophones(all.filter((d) => d.kind === 'audioinput' && d.deviceId && !['default', 'communications'].includes(d.deviceId)).map((d, i) => ({ id: d.deviceId, label: d.label || `Microphone ${i + 1}` })))
    } catch (error) { toast.error('Couldn’t list devices', { description: error instanceof Error ? error.message : String(error) }) }
  }
  useEffect(() => {
    if (!open || !navigator.mediaDevices) return
    void refresh()
    navigator.mediaDevices.addEventListener('devicechange', refresh)
    return () => navigator.mediaDevices.removeEventListener('devicechange', refresh)
  }, [open])
  return { cameras, microphones, refresh }
}

export function LiveStudio({ showLabel = false }: { showLabel?: boolean }) {
  const [open, setOpen] = useState(false)
  const [chosen, setChosen] = useState<string[]>([])
  const [cameraLevels, setCameraLevels] = useState<number[]>([])
  const [active, setActive] = useState('')
  const [cameraState, setCameraState] = useState<Record<string, CameraState>>({})
  const [micChannels, setMicChannels] = useState<MicChannel[]>(EMPTY_MICS)
  const [transition, setTransition] = useState<LiveTransition>('cut')
  const [look, setLook] = useState<LiveLook>('clean')
  const [title, setTitle] = useState('')
  const [endpoint, setEndpoint] = useState('rtmps://a.rtmps.youtube.com/live2')
  const [key, setKey] = useState('')
  const [fps, setFps] = useState(30)
  const [quality, setQuality] = useState(6)
  const [busy, setBusy] = useState(false)
  const [overlay, setOverlay] = useState<LiveImage | null>(null)
  const [images, setImages] = useState<LiveImage[]>([])
  const [sounds, setSounds] = useState<LiveSound[]>([])
  const [program, setProgram] = useState<LiveProgram | null>(null)
  const [recording, setRecording] = useState(false)
  const [capture, setCapture] = useState(false)
  const [streamState, setStreamState] = useState('')
  const [portalHost, setPortalHost] = useState<HTMLElement | null>(null)
  const studioWindowRef = useRef<Window | null>(null)
  const cameraLevelsRef = useRef(cameraLevels)
  const cameraFadeRef = useRef<number | null>(null)
  const fileImage = useRef<HTMLInputElement>(null)
  const fileVideo = useRef<HTMLInputElement>(null)
  const fileAudio = useRef<HTMLInputElement>(null)
  const liveState = useLiveStudio((s) => s)
  const programRef = useRef(program)
  const cameraStateRef = useRef(cameraState)
  const imagesRef = useRef(images)
  programRef.current = program; cameraStateRef.current = cameraState; imagesRef.current = images
  cameraLevelsRef.current = cameraLevels
  const settings = useEditor((s) => s.project.settings)
  const assets = useEditor(useShallow((s) => Object.values(s.project.assets)))
  const { cameras, microphones, refresh } = useDevices(open)
  const cameraFeeds: CameraFeed[] = chosen.flatMap((id, index) => cameraState[id]?.stream ? [{ id, stream: cameraState[id].stream!, level: cameraLevels[index] ?? 0 }] : [])

  const applyCameraLevels = (levels: number[]) => {
    const next = levels.map((level) => Math.max(0, Math.min(100, Math.round(level))))
    cameraLevelsRef.current = next
    setCameraLevels(next)
    program?.setCameraLevels(Object.fromEntries(chosen.map((id, index) => [id, (next[index] ?? 0) / 100])))
  }

  const fadeToCamera = (index: number) => {
    const id = chosen[index]
    if (!id) return
    setActive(id)
    const target = chosen.map((_, i) => i === index ? 100 : 0)
    if (cameraFadeRef.current !== null) cancelAnimationFrame(cameraFadeRef.current)
    program?.setActive(id, transition)
    if (transition === 'cut') { applyCameraLevels(target); return }
    const from = [...cameraLevelsRef.current]
    const start = performance.now()
    const animate = (now: number) => {
      const progress = Math.min(1, (now - start) / 400)
      applyCameraLevels(target.map((level, i) => (from[i] ?? 0) + (level - (from[i] ?? 0)) * progress))
      if (progress < 1) cameraFadeRef.current = requestAnimationFrame(animate)
      else cameraFadeRef.current = null
    }
    cameraFadeRef.current = requestAnimationFrame(animate)
  }

  const takeCamera = (id: string) => {
    const slot = chosen.indexOf(id)
    if (slot >= 0) fadeToCamera(slot)
  }

  const openSecondaryWindow = () => {
    const existing = studioWindowRef.current
    if (existing && !existing.closed) { existing.focus(); return }
    const popup = window.open('about:blank', 'faro-live-studio', 'popup=yes,width=1280,height=900,resizable=yes')
    if (!popup) { toast.error('No se pudo abrir la ventana secundaria'); return }
    const doc = popup.document
    doc.title = 'Faro · En vivo'
    doc.documentElement.className = document.documentElement.className
    doc.body.className = document.body.className
    doc.body.style.margin = '0'
    doc.body.style.minWidth = '900px'
    doc.body.style.minHeight = '620px'
    doc.body.style.overflow = 'hidden'
    const base = doc.createElement('base')
    base.href = window.location.href
    doc.head.append(base)
    for (const node of Array.from(document.head.querySelectorAll('link[rel="stylesheet"], style'))) {
      doc.head.append(doc.importNode(node, true))
    }
    const host = doc.createElement('div')
    host.style.height = '100vh'
    doc.body.append(host)
    studioWindowRef.current = popup
    setPortalHost(host)
    popup.addEventListener('beforeunload', () => {
      if (studioWindowRef.current !== popup) return
      studioWindowRef.current = null
      setPortalHost(null)
      setOpen(false)
    }, { once: true })
    popup.focus()
  }

  const returnToEditor = () => {
    const popup = studioWindowRef.current
    studioWindowRef.current = null
    setPortalHost(null)
    if (popup && !popup.closed) window.setTimeout(() => popup.close(), 100)
  }

  const selectOverlay = (next: LiveImage | null) => {
    setOverlay(next)
    if (next?.kind === 'video' && next.image instanceof HTMLVideoElement) {
      next.image.muted = !program
      void next.image.play().catch(() => {})
    }
  }

  const addOverlay = (item: LiveImage) => {
    const next = [...imagesRef.current, item]
    imagesRef.current = next
    setImages(next)
    selectOverlay(item)
    program?.setOverlays(next)
  }

  const updateOverlay = (item: LiveImage) => {
    const next = imagesRef.current.map((current) => current.id === item.id ? item : current)
    imagesRef.current = next
    setImages(next)
    setOverlay(item)
    program?.setOverlays(next)
  }

  const setVideoAudioLevel = (item: LiveImage, audioLevel: number) => {
    const next = imagesRef.current.map((current) => current.id === item.id ? { ...current, audioLevel } : current)
    imagesRef.current = next
    setImages(next)
    if (overlay?.id === item.id) setOverlay(next.find((current) => current.id === item.id) ?? null)
    program?.setOverlays(next)
  }

  const removeOverlay = (item: LiveImage) => {
    const next = imagesRef.current.filter((current) => current.id !== item.id)
    imagesRef.current = next
    setImages(next)
    if (overlay?.id === item.id) selectOverlay(next.at(-1) ?? null)
    if (item.kind === 'image' && item.image instanceof ImageBitmap) item.image.close()
    if (item.kind === 'video' && item.image instanceof HTMLVideoElement) { item.image.pause(); URL.revokeObjectURL(item.image.src) }
    program?.setOverlays(next)
  }

  useEffect(() => { if (program && liveState.status) setStreamState(liveState.status) }, [liveState.status, program])
  useEffect(() => {
    if (!liveState.program && program) {
      setProgram(null); setCapture(false); setKey(''); setRecording(false)
    }
  }, [liveState.program, program])
  useEffect(() => {
    if (!open) return
    return () => {
      for (const item of Object.values(cameraStateRef.current)) item.stream?.getTracks().forEach((t) => t.stop())
      if (programRef.current) void programRef.current.stop()
    }
  }, [open])
  useEffect(() => () => { if (cameraFadeRef.current !== null) cancelAnimationFrame(cameraFadeRef.current) }, [])
  useEffect(() => () => {
    for (const item of imagesRef.current) {
      if (item.kind === 'image' && item.image instanceof ImageBitmap) item.image.close()
      if (item.kind === 'video' && item.image instanceof HTMLVideoElement) { item.image.pause(); URL.revokeObjectURL(item.image.src) }
    }
  }, [])

  const openCamera = async (id: string) => {
    if (!chosen.includes(id) && chosen.length < 3) {
      setChosen((cur) => cur.includes(id) || cur.length >= 3 ? cur : [...cur, id])
      const nextLevels = [...cameraLevelsRef.current]
      nextLevels.push(nextLevels.length === 0 ? 100 : 0)
      cameraLevelsRef.current = nextLevels
      setCameraLevels(nextLevels)
    }
    setCameraState((s) => ({ ...s, [id]: { stream: s[id]?.stream ?? null, error: null } }))
    if (cameraState[id]?.stream?.active) return
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { deviceId: { exact: id }, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30, max: 30 } }, audio: false })
      setCameraState((s) => ({ ...s, [id]: { stream, error: null } }))
      setActive((a) => a || id)
    } catch (error) {
      setCameraState((s) => ({ ...s, [id]: { stream: null, error: error instanceof Error ? error.message : String(error) } }))
      toast.error('Couldn’t open camera', { description: error instanceof Error ? error.message : String(error) })
    }
  }

  const useImage = async (file: File) => {
    try {
      const image = await createImageBitmap(file)
      const item: LiveImage = { id: crypto.randomUUID(), name: file.name, image, width: image.width, height: image.height, kind: 'image', x: 0.5, y: 0.5, scale: 0.72 }
      addOverlay(item)
    } catch (error) { toast.error('Couldn’t load image', { description: error instanceof Error ? error.message : String(error) }) }
  }
  const useVideo = async (file: File) => {
    const video = document.createElement('video')
    video.src = URL.createObjectURL(file); video.loop = true; video.muted = true; video.playsInline = true; video.preload = 'auto'
    try {
      await new Promise<void>((resolve, reject) => { video.onloadedmetadata = () => resolve(); video.onerror = () => reject(new Error('Couldn’t read this video file.')) })
      const item: LiveImage = { id: crypto.randomUUID(), name: file.name, image: video, width: video.videoWidth, height: video.videoHeight, kind: 'video', x: 0.5, y: 0.5, scale: 0.72, audioLevel: 100 }
      addOverlay(item)
    } catch (error) { URL.revokeObjectURL(video.src); toast.error('Couldn’t load video', { description: error instanceof Error ? error.message : String(error) }) }
  }
  const useSound = async (file: File) => {
    try {
      const ctx = new AudioContext()
      const buffer = await ctx.decodeAudioData(await file.arrayBuffer())
      const item: LiveSound = { id: crypto.randomUUID(), name: file.name, buffer, level: 100 }
      setSounds((s) => [...s, item]); await ctx.close()
    } catch (error) { toast.error('Couldn’t load audio', { description: error instanceof Error ? error.message : String(error) }) }
  }
  const addProjectAsset = async (assetId: string) => {
    const asset = assets.find((a) => a.id === assetId)
    if (!asset || asset.source.type !== 'file') return
    try {
      if (asset.kind === 'image') {
        const image = await createImageBitmap(await (await fetch(asset.source.url)).blob())
        const item: LiveImage = { id: crypto.randomUUID(), name: asset.name, image, width: image.width, height: image.height, kind: 'image', x: 0.5, y: 0.5, scale: 0.72 }
        addOverlay(item)
      } else if (asset.kind === 'video') {
        const video = document.createElement('video')
        video.src = asset.source.url; video.loop = true; video.muted = true; video.playsInline = true; video.preload = 'auto'
        await new Promise<void>((resolve, reject) => { video.onloadedmetadata = () => resolve(); video.onerror = () => reject(new Error('Couldn’t read this video file.')) })
        const item: LiveImage = { id: crypto.randomUUID(), name: asset.name, image: video, width: video.videoWidth, height: video.videoHeight, kind: 'video', x: 0.5, y: 0.5, scale: 0.72, audioLevel: 100 }
        addOverlay(item)
      } else if (asset.kind === 'audio') {
        const ctx = new AudioContext(); const buffer = await ctx.decodeAudioData(await (await fetch(asset.source.url)).arrayBuffer())
        const item: LiveSound = { id: crypto.randomUUID(), name: asset.name, buffer, level: 100 }; setSounds((s) => [...s, item]); await ctx.close()
      }
    } catch (error) { toast.error(`Couldn’t load ${asset.name}`, { description: error instanceof Error ? error.message : String(error) }) }
  }
  const goLive = async () => {
    if (!desktop) return void toast.error('Live streaming works in the Faro desktop app.')
    if (!chosen.length || !key.trim()) return
    setBusy(true)
    const next = new LiveProgram()
    try {
      for (const id of chosen) {
        const stream = cameraState[id]?.stream
        if (!stream) throw new Error(`${cameras.find((d) => d.id === id)?.label ?? 'A camera'} is not ready.`)
        await next.addCamera(id, cameras.find((d) => d.id === id)?.label ?? 'Camera', stream)
      }
        next.setActive(active, 'cut'); next.setTransition(transition); next.setCameraLevels(Object.fromEntries(chosen.map((id, index) => [id, (cameraLevelsRef.current[index] ?? 0) / 100]))); next.setLook(look); next.setOverlays(imagesRef.current); next.setTitle(title)
      setProgram(next)
      liveState.setProgram(next)
      await next.start({ endpoint, streamKey: key, width: settings.width, height: settings.height, fps, bitrate: quality * 1_000_000 })
      for (const [index, channel] of micChannels.entries()) if (channel.id) await next.setMicrophone(index, channel.id, channel.level, channel.muted)
      setCapture(true); setStreamState('Connecting to destination…')
    } catch (error) {
      await next.stop().catch(() => {})
      setProgram(null); liveState.setProgram(null)
      toast.error('Couldn’t start live stream', { description: error instanceof Error ? error.message : String(error) })
    } finally { setBusy(false) }
  }
  const stop = async () => { await program?.stop(); setProgram(null); setCapture(false); setStreamState(''); setKey(''); liveState.setProgram(null) }
  const toggleRecording = async () => {
    if (!program) return
    if (recording) {
      try {
        const path = await program.stopLocalRecording()
        setRecording(false)
        if (path) toast.success('Vivo guardado', { description: path })
      } catch (error) { setRecording(false); toast.error('No se pudo guardar la grabación', { description: error instanceof Error ? error.message : String(error) }) }
      return
    }
    try {
      const path = await program.startLocalRecording()
      if (path) { setRecording(true); toast.success('Grabación local iniciada', { description: path }) }
    } catch (error) { toast.error('No se pudo iniciar la grabación', { description: error instanceof Error ? error.message : String(error) }) }
  }

  return <>
    {showLabel ? (
      <Tip content="Abrir estudio multicámara y transmitir en vivo" side="right">
        <button type="button" aria-label="En vivo" aria-pressed={Boolean(program)} title="En vivo" onClick={() => setOpen(true)} className={cn('group relative flex w-[52px] flex-col items-center gap-1 rounded-[10px] pt-2 pb-1.5 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent/60', program ? 'bg-red-500/10 text-red-300' : 'text-fg-3 hover:bg-white/[0.06] hover:text-fg-2')}>
          <Radio className="relative size-[18px]" />
          <span className="relative text-[10px] leading-none font-medium">En vivo</span>
        </button>
      </Tip>
    ) : <IconButton label={program ? 'Open live studio · streaming' : 'Open live studio'} active={Boolean(program)} onClick={() => setOpen(true)}><Radio /></IconButton>}
    <Dialog container={portalHost} open={open} onOpenChange={(v) => (!busy && (program ? !v : setOpen(v)))} title="Live studio" description="Switch cameras, add images and sound, and publish the program over RTMP or RTMPS." className={portalHost ? '!top-0 !left-0 !h-screen !max-h-screen !w-full !max-w-none !translate-x-0 !translate-y-0 !rounded-none' : 'w-[min(1000px,calc(100vw-32px))]'}>
      <div className="max-h-[calc(100vh-190px)] space-y-4 overflow-y-auto px-5 pb-4">
        <div className="flex items-center justify-between"><div><div className="text-xs font-medium text-fg-2">Camera inputs · slots A, B y C</div><div className="text-2xs text-fg-4">USB cameras y placas HDMI aparecen acá.</div></div><Button size="sm" variant="ghost" disabled={Boolean(program)} onClick={() => void refresh()}><RefreshCw />Actualizar</Button></div>
        {!cameras.length ? <div className="rounded-xl border border-dashed border-line-2 px-4 py-6 text-center"><Camera className="mx-auto mb-2 size-5 text-fg-4" /><div className="text-sm text-fg-2">No se encontraron cámaras</div><div className="mt-1 text-xs text-fg-4">Conectá una webcam o placa de captura y actualizá.</div></div> : <div className="grid grid-cols-2 gap-2 md:grid-cols-3">{cameras.map((d) => <CameraCard key={d.id} device={d} state={cameraState[d.id]} selected={chosen.includes(d.id)} active={active === d.id} locked={Boolean(program) || (!chosen.includes(d.id) && chosen.length >= 3)} onPick={() => void openCamera(d.id)} onTake={() => takeCamera(d.id)} />)}</div>}

        <section className="space-y-3 rounded-xl border border-line bg-black/15 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2"><div><div className="text-xs font-semibold text-fg-2">Master · Programa</div><div className="text-2xs text-fg-4">Vista final que se envía al directo</div></div><div className="flex gap-2"><label className="flex items-center gap-1.5 text-2xs text-fg-3">Transición<Select aria-label="Live camera transition" value={transition} onChange={(v) => { const next = v as LiveTransition; setTransition(next); program?.setTransition(next) }} options={[{ value: 'cut', label: 'Corte' }, { value: 'dissolve', label: 'Fundido · 0,4 s' }]} /></label><label className="flex items-center gap-1.5 text-2xs text-fg-3">Look<Select aria-label="Live video look" value={look} onChange={(v) => { const next = v as LiveLook; setLook(next); program?.setLook(next) }} options={[{ value: 'clean', label: 'Natural' }, { value: 'cinema', label: 'Cine' }, { value: 'warm', label: 'Cálido' }, { value: 'mono', label: 'Blanco y negro' }]} /></label></div></div>
          <ProgramMonitor feeds={cameraFeeds} title={title} overlays={images} selectedOverlay={overlay} look={look} onOverlayChange={updateOverlay} />
          <div className="flex items-center gap-2 text-2xs text-fg-4"><span className="size-2 rounded-full bg-red-400" />Salida · {chosen.map((_, index) => (cameraLevels[index] ?? 0) > 0 ? String.fromCharCode(65 + index) : '').filter(Boolean).join(' + ') || 'sin señal'}<span className="ml-auto">{transition === 'cut' ? 'Corte directo' : 'Fundido cruzado'}</span></div>
          {chosen.length > 0 && <div className="grid gap-2 md:grid-cols-3">{chosen.map((id, index) => <div key={id} className="rounded-lg bg-black/25 p-2"><div className="mb-1.5 flex items-center gap-2"><Button size="xs" variant={active === id ? 'primary' : 'secondary'} onClick={() => fadeToCamera(index)}>{String.fromCharCode(65 + index)}</Button><span className="min-w-0 flex-1 truncate text-2xs text-fg-3">{cameras.find((d) => d.id === id)?.label ?? `Cámara ${index + 1}`}</span><span className="text-2xs tabular-nums text-fg-4">{cameraLevels[index] ?? 0}%</span></div><input aria-label={`Fader de cámara ${String.fromCharCode(65 + index)}`} type="range" min="0" max="100" value={cameraLevels[index] ?? 0} onChange={(event) => { const next = [...cameraLevelsRef.current]; next[index] = Number(event.target.value); if (cameraFadeRef.current !== null) cancelAnimationFrame(cameraFadeRef.current); cameraFadeRef.current = null; applyCameraLevels(next) }} className="w-full accent-[var(--accent)]" /></div>)}</div>}
          <p className="text-2xs text-fg-4">Mové los faders para mezclar cámaras; A, B y C hacen el corte o fundido automático según la transición elegida.</p>
        </section>

        <div className="grid gap-3 md:grid-cols-2">
          <section className="space-y-2 rounded-xl bg-black/20 p-3"><div className="flex items-center justify-between text-xs font-medium text-fg-2"><span className="flex items-center gap-1.5"><ImagePlus className="size-3.5 text-accent-2" />Gráficos y video</span><div className="flex gap-1"><Button size="xs" onClick={() => fileImage.current?.click()}><FilePlus2 />Imagen</Button><Button size="xs" onClick={() => fileVideo.current?.click()}><Video />Video</Button></div><input ref={fileImage} hidden type="file" accept="image/*" multiple onChange={(e) => { for (const file of Array.from(e.currentTarget.files ?? [])) void useImage(file); e.currentTarget.value = '' }} /><input ref={fileVideo} hidden type="file" accept="video/*" multiple onChange={(e) => { for (const file of Array.from(e.currentTarget.files ?? [])) void useVideo(file); e.currentTarget.value = '' }} /></div>
            <Select aria-label="Add program visual" value="" onChange={(id) => void addProjectAsset(id)} options={[{ value: '', label: 'Agregar desde Medios…' }, ...assets.filter((a) => a.kind === 'image' || a.kind === 'video').map((a) => ({ value: a.id, label: `${a.kind === 'video' ? '▶ ' : '▧ '}${a.name}` }))]} />
            <div className="flex flex-wrap gap-1.5">{images.map((i) => <div key={i.id} className={cn('flex items-center gap-1 rounded-md px-2 py-1 text-2xs', overlay?.id === i.id ? 'bg-accent/15 text-accent-2' : 'bg-white/[0.05] text-fg-3')}><button type="button" onClick={() => selectOverlay(i)} className="flex min-w-0 items-center gap-1"><FileImage className="size-3 shrink-0" /><span className="max-w-40 truncate">{i.kind === 'video' ? '▶ ' : ''}{i.name}</span></button>{i.kind === 'video' && <label className="flex items-center gap-1" title="Volumen del video"><Volume2 className="size-3" /><input aria-label={`Fader de audio de ${i.name}`} type="range" min="0" max="150" value={i.audioLevel ?? 100} onChange={(event) => setVideoAudioLevel(i, Number(event.target.value))} className="w-16 accent-[var(--accent)]" /></label>}<button type="button" aria-label={`Quitar ${i.name}`} onClick={() => removeOverlay(i)} className="rounded p-0.5 hover:bg-white/10"><X className="size-3" /></button></div>)}</div>
            <p className="text-2xs text-fg-4">Las capas se superponen y permanecen en pantalla. Elegí una para moverla o cambiar su tamaño.</p>
            <Row label="Título en vivo"><Input value={title} onChange={(e) => { setTitle(e.target.value); program?.setTitle(e.target.value) }} placeholder="Texto sobre la imagen" onKeyDown={(e) => e.stopPropagation()} /></Row>
          </section>
          <section className="space-y-2 rounded-xl bg-black/20 p-3"><div className="flex items-center justify-between text-xs font-medium text-fg-2"><span className="flex items-center gap-1.5"><AudioLines className="size-3.5 text-accent-2" />Faders de audio · micrófonos y sonidos</span><Button size="xs" onClick={() => fileAudio.current?.click()}><FilePlus2 />Agregar audio/efecto</Button><input ref={fileAudio} hidden type="file" accept="audio/*" multiple onChange={(e) => { for (const file of Array.from(e.currentTarget.files ?? [])) void useSound(file); e.currentTarget.value = '' }} /></div>
          {micChannels.map((channel, index) => <div key={index} className="grid grid-cols-[minmax(0,1fr)_34px_minmax(58px,1fr)_34px] items-center gap-2"><Select aria-label={`Microphone channel ${index + 1}`} value={channel.id} onChange={(id) => { setMicChannels((old) => old.map((m, i) => i === index ? { ...m, id } : m)); if (program) void program.setMicrophone(index, id || null, channel.level, channel.muted).catch((error) => toast.error('Couldn’t open microphone', { description: error instanceof Error ? error.message : String(error) })) }} options={[{ value: '', label: `Mic ${index + 1} · sin asignar` }, ...microphones.filter((d) => !micChannels.some((m, i) => i !== index && m.id === d.id)).map((d) => ({ value: d.id, label: d.label }))]} /><Button size="xs" variant={channel.muted ? 'danger' : 'ghost'} aria-label={`${channel.muted ? 'Unmute' : 'Mute'} microphone ${index + 1}`} onClick={() => { const muted = !channel.muted; setMicChannels((old) => old.map((m, i) => i === index ? { ...m, muted } : m)); program?.setMicrophoneLevel(index, channel.level, muted) }}>{channel.muted ? <VolumeX /> : <Volume2 />}</Button><input aria-label={`Fader de audio del micrófono ${index + 1}`} title={`Volumen de micrófono ${index + 1}: ${channel.level}%`} type="range" min="0" max="150" value={channel.level} onChange={(e) => { const level = Number(e.target.value); setMicChannels((old) => old.map((m, i) => i === index ? { ...m, level } : m)); program?.setMicrophoneLevel(index, level, channel.muted) }} className="w-full accent-[var(--accent)]" /><span className="text-right text-2xs tabular-nums text-fg-4">{channel.level}%</span></div>)}
            <Select aria-label="Add project sound" value="" onChange={(id) => void addProjectAsset(id)} options={[{ value: '', label: 'Add from Media library…' }, ...assets.filter((a) => a.kind === 'audio').map((a) => ({ value: a.id, label: a.name }))]} />
            <div className="space-y-1">{sounds.map((s) => <div key={s.id} className="grid grid-cols-[auto_minmax(0,1fr)_86px_34px] items-center gap-2"><Button size="xs" variant="ghost" disabled={!program} aria-label={`Reproducir ${s.name}`} onClick={() => void program?.playSound(s)}><Volume2 /></Button><span className="truncate text-2xs text-fg-3">{s.name}</span><input aria-label={`Fader de audio de ${s.name}`} type="range" min="0" max="150" value={s.level} onChange={(event) => { const level = Number(event.target.value); setSounds((current) => current.map((item) => item.id === s.id ? { ...item, level } : item)); program?.setSoundLevel(s.id, level) }} className="w-full accent-[var(--accent)]" /><span className="text-right text-2xs tabular-nums text-fg-4">{s.level}%</span></div>)}</div>
          </section>
        </div>

        <section className="space-y-3 rounded-xl border border-line bg-black/15 p-3"><div className="flex items-center gap-2 text-xs font-semibold text-fg-2"><Video className="size-4 text-accent-2" />Stream output · {settings.width}×{settings.height}</div><div className="grid gap-x-4 gap-y-2 md:grid-cols-2">
          <Row label="Cámara de programa"><Select aria-label="Program camera" value={active} onChange={takeCamera} options={cameras.filter((d) => chosen.includes(d.id)).map((d) => ({ value: d.id, label: d.label }))} /></Row>
          <Row label="Frame rate"><Select aria-label="Live frame rate" value={String(fps)} onChange={(v) => setFps(Number(v))} options={[{ value: '30', label: '30 fps' }, { value: '60', label: '60 fps' }]} /></Row>
          <Row label="RTMP(S) server"><Input value={endpoint} disabled={Boolean(program)} onChange={(e) => setEndpoint(e.target.value)} placeholder="rtmps://server/live" onKeyDown={(e) => e.stopPropagation()} /></Row>
          <Row label="Stream key"><Input type="password" value={key} disabled={Boolean(program)} onChange={(e) => setKey(e.target.value)} autoComplete="new-password" placeholder="Private stream key" onKeyDown={(e) => e.stopPropagation()} /></Row>
          <Row label="Video bitrate"><Select aria-label="Video bitrate" value={String(quality)} onChange={(v) => setQuality(Number(v))} options={[{ value: '4', label: '4 Mbps · 720p' }, { value: '6', label: '6 Mbps · 1080p' }, { value: '9', label: '9 Mbps · 1440p' }, { value: '16', label: '16 Mbps · 4K' }]} /></Row>
        </div>
          <p className="text-2xs leading-relaxed text-fg-4">Micrófonos y sonidos se mezclan juntos. Tocá los audios durante la transmisión para lanzarlos sobre las voces; los videos agregados a gráficos aportan imagen y audio al programa. El timeline del editor no se transmite.</p>
          {streamState && <div className="flex items-center gap-2 text-xs text-fg-3"><span className={cn('size-2 rounded-full', capture ? 'animate-pulse bg-danger' : 'bg-warn')} />{streamState}{recording && <span className="ml-auto inline-flex items-center gap-1.5 text-danger"><span className="size-2 animate-pulse rounded-full bg-danger" />Grabando localmente</span>}</div>}
        </section>
      </div>
      <div className="flex items-center justify-between gap-3 border-t border-line px-5 py-3"><span className="text-2xs text-fg-4">FFmpeg must be available to Faro to send RTMP(S).</span><div className="flex items-center gap-2">{portalHost ? <Button variant="ghost" onClick={returnToEditor}>Volver al editor</Button> : <Button variant="ghost" onClick={openSecondaryWindow}>Abrir ventana secundaria</Button>}{program && <Button variant={recording ? 'danger' : 'secondary'} disabled={busy} title="La grabación local se guarda en WebM; al iniciarla elegís el nombre y la carpeta." onClick={() => void toggleRecording()}>{recording ? <CircleStop /> : <Radio />}{recording ? 'Detener grabación' : 'Grabar vivo'}</Button>}{program ? <Button variant="danger" onClick={() => void stop()}><CircleStop />Stop live</Button> : <Button variant="primary" disabled={busy || !chosen.length || !active || !key.trim()} onClick={() => void goLive()}>{busy ? <Loader2 className="animate-spin" /> : <Radio />}{busy ? 'Connecting…' : 'Go live'}</Button>}</div></div>
    </Dialog>
  </>
}

function ProgramMonitor({ feeds, title, overlays, selectedOverlay, look, onOverlayChange }: { feeds: CameraFeed[]; title: string; overlays: LiveImage[]; selectedOverlay: LiveImage | null; look: LiveLook; onOverlayChange: (item: LiveImage) => void }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const feedsRef = useRef(feeds)
  const overlaysRef = useRef(overlays)
  const overlayRef = useRef(selectedOverlay)
  const titleRef = useRef(title)
  const lookRef = useRef(look)
  const drag = useRef<{ pointer: number; mode: 'move' | 'resize'; offsetX: number; offsetY: number; startX: number; startY: number; startScale: number; boxW: number; boxH: number } | null>(null)
  feedsRef.current = feeds; overlaysRef.current = overlays; overlayRef.current = selectedOverlay; titleRef.current = title; lookRef.current = look
  const feedKey = feeds.map((feed) => `${feed.id}:${feed.stream.id}`).join('|')
  useEffect(() => {
    const canvas = ref.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    const videos = new Map<string, HTMLVideoElement>()
    for (const feed of feedsRef.current) {
      const video = document.createElement('video')
      video.muted = true; video.playsInline = true; video.srcObject = feed.stream
      void video.play().catch(() => {})
      videos.set(feed.id, video)
    }
    let frame = 0
    const draw = () => {
      const { width, height } = canvas
      ctx.fillStyle = '#08090b'; ctx.fillRect(0, 0, width, height)
      ctx.filter = LOOK_FILTER[lookRef.current]
      const totalLevel = feedsRef.current.reduce((sum, feed) => sum + feed.level / 100, 0)
      const normalize = Math.max(1, totalLevel)
      ctx.globalCompositeOperation = 'lighter'
      for (const feed of feedsRef.current) {
        const video = videos.get(feed.id)
        if (!video || feed.level <= 0 || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) continue
        const scale = Math.max(width / video.videoWidth, height / video.videoHeight)
        const w = video.videoWidth * scale; const h = video.videoHeight * scale
        ctx.globalAlpha = feed.level / 100 / normalize
        ctx.drawImage(video, (width - w) / 2, (height - h) / 2, w, h)
      }
      ctx.globalAlpha = 1; ctx.filter = 'none'; ctx.globalCompositeOperation = 'source-over'
      for (const visual of overlaysRef.current) {
        const scale = Math.min(width * 0.8 / visual.width, height * 0.8 / visual.height) * visual.scale
        const w = visual.width * scale; const h = visual.height * scale
        const x = width * visual.x - w / 2; const y = height * visual.y - h / 2
        try { ctx.drawImage(visual.image, x, y, w, h) } catch { /* Video frame not ready yet. */ }
        if (visual.id === overlayRef.current?.id) {
          ctx.strokeStyle = '#d6ee00'; ctx.lineWidth = 3; ctx.strokeRect(x, y, w, h)
          ctx.fillStyle = '#d6ee00'; ctx.fillRect(x + w - 16, y + h - 16, 16, 16)
        }
      }
      if (titleRef.current) {
        ctx.font = `600 ${Math.round(height * 0.055)}px sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom'
        ctx.lineWidth = 5; ctx.strokeStyle = 'rgba(0,0,0,.8)'; ctx.fillStyle = '#fff'
        ctx.strokeText(titleRef.current, width / 2, height * 0.93, width * 0.9); ctx.fillText(titleRef.current, width / 2, height * 0.93, width * 0.9)
      }
      frame = requestAnimationFrame(draw)
    }
    draw()
    return () => { cancelAnimationFrame(frame); for (const video of videos.values()) { video.pause(); video.srcObject = null } }
  }, [feedKey])
  const point = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const canvas = event.currentTarget; const rect = canvas.getBoundingClientRect()
    return { x: (event.clientX - rect.left) / rect.width * canvas.width, y: (event.clientY - rect.top) / rect.height * canvas.height }
  }
  const beginOverlayDrag = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const visual = overlayRef.current; const canvas = ref.current
    if (!visual || !canvas) return
    const p = point(event); const w = Math.min(canvas.width * 0.8 / visual.width, canvas.height * 0.8 / visual.height) * visual.scale * visual.width
    const h = Math.min(canvas.width * 0.8 / visual.width, canvas.height * 0.8 / visual.height) * visual.scale * visual.height
    const x = canvas.width * visual.x - w / 2; const y = canvas.height * visual.y - h / 2
    if (p.x < x || p.x > x + w || p.y < y || p.y > y + h) return
    const resize = p.x > x + w - 24 && p.y > y + h - 24
    drag.current = { pointer: event.pointerId, mode: resize ? 'resize' : 'move', offsetX: p.x - canvas.width * visual.x, offsetY: p.y - canvas.height * visual.y, startX: p.x, startY: p.y, startScale: visual.scale, boxW: w, boxH: h }
    canvas.setPointerCapture(event.pointerId)
  }
  const moveOverlay = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const task = drag.current; const visual = overlayRef.current; const canvas = ref.current
    if (!task || task.pointer !== event.pointerId || !visual || !canvas) return
    const p = point(event)
    const next = task.mode === 'move'
      ? { ...visual, x: Math.max(0, Math.min(1, (p.x - task.offsetX) / canvas.width)), y: Math.max(0, Math.min(1, (p.y - task.offsetY) / canvas.height)) }
      : { ...visual, scale: Math.max(0.12, Math.min(1.8, task.startScale + ((p.x - task.startX) / task.boxW + (p.y - task.startY) / task.boxH) * task.startScale / 2)) }
    overlayRef.current = next; onOverlayChange(next)
  }
  return <canvas ref={ref} width={1280} height={720} aria-label="Monitor maestro; arrastrá la capa seleccionada para moverla y su esquina para cambiar el tamaño" onPointerDown={beginOverlayDrag} onPointerMove={moveOverlay} onPointerUp={() => { drag.current = null }} onPointerCancel={() => { drag.current = null }} className={cn('aspect-video w-full rounded-lg bg-black object-contain', selectedOverlay && 'cursor-move')} />
}

function CameraCard({ device, state, selected, active, locked, onPick, onTake }: { device: Device; state?: CameraState; selected: boolean; active: boolean; locked: boolean; onPick: () => void; onTake: () => void }) {
  const ref = useRef<HTMLVideoElement>(null)
  useEffect(() => { if (ref.current) { ref.current.srcObject = state?.stream ?? null; if (state?.stream) void ref.current.play().catch(() => {}) } }, [state?.stream])
  return <div className={cn('overflow-hidden rounded-xl border bg-black/20', active ? 'border-accent/70' : 'border-line')}><button type="button" onClick={onPick} disabled={locked} className="relative block aspect-video w-full bg-black"><video ref={ref} muted autoPlay playsInline className="h-full w-full object-contain" />{!selected && <span className="absolute inset-0 grid place-items-center bg-black/55 text-xs text-fg-3"><Camera className="mr-1 inline size-3.5" /> Add camera</span>}{state?.error && <span className="absolute inset-x-0 bottom-0 bg-danger/80 p-1 text-2xs text-white">{state.error}</span>}<span className="absolute left-2 top-2 rounded bg-black/65 px-1.5 py-0.5 text-2xs text-white">{active ? 'PROGRAM' : selected ? 'PREVIEW' : 'OFF'}</span></button><div className="flex h-8 items-center gap-1 px-2"><span className="min-w-0 flex-1 truncate text-xs text-fg-2">{device.label}</span>{selected && !active && <Button size="xs" disabled={locked} onClick={onTake}>Take</Button>}</div></div>
}
