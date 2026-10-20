import { create } from 'zustand'
import { desktop } from '@/lib/platform'

export type LiveImage = { id: string; name: string; image: CanvasImageSource; width: number; height: number; kind: 'image' | 'video'; x: number; y: number; scale: number; audioLevel?: number }
export type LiveSound = { id: string; name: string; buffer: AudioBuffer; level: number }
type LiveConfig = { endpoint: string; streamKey: string; width: number; height: number; fps: number; bitrate: number }
export type LiveTransition = 'cut' | 'dissolve'
export type LiveLook = 'clean' | 'cinema' | 'warm' | 'mono'
let sharedAudioContext: AudioContext | null = null
const videoAudioSources = new WeakMap<HTMLVideoElement, MediaElementAudioSourceNode>()
type LiveState = { program: LiveProgram | null; setProgram(program: LiveProgram | null): void; status: string }
export const useLiveStudio = create<LiveState>(() => ({ program: null, status: '', setProgram: (program) => useLiveStudio.setState({ program }) }))

export class LiveProgram {
  private cameras = new Map<string, { name: string; element: HTMLVideoElement; stream: MediaStream }>()
  private canvas = document.createElement('canvas')
  private ctx = this.canvas.getContext('2d', { alpha: false })!
  private recorder: MediaRecorder | null = null
  private localRecorder: MediaRecorder | null = null
  private localFile: { id: string; path: string } | null = null
  private localOutput: MediaStream | null = null
  private localPosition = 0
  private localWrites: Promise<void> = Promise.resolve()
  private localWriteError: unknown = null
  private localStopPromise: Promise<string | null> | null = null
  private interval: ReturnType<typeof setInterval> | null = null
  private audioContext: AudioContext | null = null
  private destination: MediaStreamAudioDestinationNode | null = null
  private microphones = new Map<number, { stream: MediaStream; gain: GainNode }>()
  private soundGains = new Map<string, Set<GainNode>>()
  private activeCamera = ''
  private cameraLevels = new Map<string, number>()
  private transition: { from: Map<string, number>; to: Map<string, number>; start: number; duration: number } | null = null
  private transitionType: LiveTransition = 'cut'
  private look: LiveLook = 'clean'
  private overlays: LiveImage[] = []
  private overlayAudio = new Map<string, { gain: GainNode; source: MediaElementAudioSourceNode }>()
  private title = ''
  private stopped = false
  private statusUnsub: (() => void) | null = null

  async addCamera(id: string, name: string, preview: MediaStream) {
    const track = preview.getVideoTracks()[0]
    if (!track || track.readyState !== 'live') throw new Error(`${name} is not sending a live picture.`)
    const stream = new MediaStream([track.clone()])
    const video = document.createElement('video')
    video.muted = true
    video.playsInline = true
    video.srcObject = stream
    await video.play()
    this.cameras.set(id, { name, element: video, stream })
    this.cameraLevels.set(id, this.cameras.size === 1 ? 1 : 0)
  }

  setActive(id: string, transition: LiveTransition = this.transitionType, duration = 400) {
    if (!this.cameras.has(id)) return
    this.transitionType = transition
    this.activeCamera = id
    const from = new Map(this.cameraLevels)
    const to = new Map([...this.cameras.keys()].map((cameraId) => [cameraId, cameraId === id ? 1 : 0]))
    const changed = [...this.cameras.keys()].some((cameraId) => (from.get(cameraId) ?? 0) !== (to.get(cameraId) ?? 0))
    if (transition === 'dissolve' && changed) this.transition = { from, to, start: performance.now(), duration }
    else { this.cameraLevels = to; this.transition = null }
  }
  setCameraLevels(levels: Record<string, number>) {
    this.transition = null
    for (const id of this.cameras.keys()) this.cameraLevels.set(id, Math.max(0, Math.min(1, Number(levels[id] ?? 0))))
  }
  setTransition(type: LiveTransition) { this.transitionType = type }
  setLook(look: LiveLook) { this.look = look }
  setMicrophoneLevel(index: number, value: number, muted: boolean) {
    const channel = this.microphones.get(index)
    if (channel) channel.gain.gain.value = muted ? 0 : Math.max(0, Math.min(1.5, value / 100))
  }
  setOverlays(images: LiveImage[]) {
    const next = new Map(images.map((image) => [image.id, image]))
    for (const [id, audio] of this.overlayAudio) {
      const stillPresent = next.get(id)?.image === this.overlays.find((image) => image.id === id)?.image
      if (!stillPresent) {
        audio.gain.disconnect(); audio.source.disconnect(); this.overlayAudio.delete(id)
        const removed = this.overlays.find((image) => image.id === id)
        if (removed?.kind === 'video' && removed.image instanceof HTMLVideoElement) removed.image.pause()
      }
    }
    this.overlays = images
    if (!this.audioContext || !this.destination) return
    for (const image of images) {
      const routed = this.overlayAudio.get(image.id)
      if (routed) routed.gain.gain.value = Math.max(0, Math.min(1.5, (image.audioLevel ?? 100) / 100))
      if (image.kind !== 'video' || !(image.image instanceof HTMLVideoElement) || routed) continue
      const video = image.image
      video.muted = false
      let source = videoAudioSources.get(video)
      if (!source) { source = this.audioContext.createMediaElementSource(video); videoAudioSources.set(video, source) }
      const gain = this.audioContext.createGain()
      gain.gain.value = Math.max(0, Math.min(1.5, (image.audioLevel ?? 100) / 100))
      source.connect(gain).connect(this.destination)
      this.overlayAudio.set(image.id, { gain, source })
      void video.play().catch(() => {})
    }
  }
  setTitle(text: string) { this.title = text.slice(0, 140) }

  async setMicrophone(index: number, id: string | null, value = 100, muted = false) {
    const previous = this.microphones.get(index)
    previous?.stream.getTracks().forEach((t) => t.stop())
    previous?.gain.disconnect()
    this.microphones.delete(index)
    if (!id || !this.audioContext || !this.destination) return
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: { exact: id }, echoCancellation: false, noiseSuppression: false, autoGainControl: false }, video: false })
    const gain = this.audioContext.createGain()
    gain.gain.value = muted ? 0 : Math.max(0, Math.min(1.5, value / 100))
    this.audioContext.createMediaStreamSource(stream).connect(gain).connect(this.destination)
    this.microphones.set(index, { stream, gain })
  }

  async playSound(sound: LiveSound) {
    if (!this.audioContext || !this.destination) return
    const source = this.audioContext.createBufferSource()
    const gain = this.audioContext.createGain()
    source.buffer = sound.buffer
    gain.gain.value = Math.max(0, Math.min(1.5, sound.level / 100))
    source.connect(gain).connect(this.destination)
    const active = this.soundGains.get(sound.id) ?? new Set<GainNode>()
    active.add(gain); this.soundGains.set(sound.id, active)
    source.onended = () => { gain.disconnect(); active.delete(gain); if (!active.size) this.soundGains.delete(sound.id) }
    source.start()
  }
  setSoundLevel(id: string, value: number) {
    const gain = Math.max(0, Math.min(1.5, value / 100))
    for (const node of this.soundGains.get(id) ?? []) node.gain.value = gain
  }

  async start(config: LiveConfig) {
    if (!desktop) throw new Error('Live streaming requires the Faro desktop app.')
    if (!this.cameras.size) throw new Error('Add at least one camera.')
    if (!this.activeCamera) this.activeCamera = this.cameras.keys().next().value ?? ''
    this.canvas.width = config.width
    this.canvas.height = config.height
    this.audioContext = sharedAudioContext ??= new AudioContext({ sampleRate: 48000, latencyHint: 'interactive' })
    await this.audioContext.resume()
    this.destination = this.audioContext.createMediaStreamDestination()
    this.setOverlays(this.overlays)
    this.statusUnsub = desktop.live.onStatus((s) => {
      useLiveStudio.setState({ status: s.message })
      if (s.state === 'error' || s.state === 'stopped') void this.stop(false)
    })
    await desktop.live.start(config)
    const stream = this.canvas.captureStream(config.fps)
    this.localOutput = stream
    stream.addTrack(this.destination.stream.getAudioTracks()[0])
    const mimeType = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'].find((m) => MediaRecorder.isTypeSupported(m))
    if (!mimeType) throw new Error('This computer’s browser does not provide a compatible live encoder.')
    this.recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: config.bitrate, audioBitsPerSecond: 192_000 })
    this.recorder.ondataavailable = (event) => { if (event.data.size) void event.data.arrayBuffer().then((b) => desktop?.live.send(new Uint8Array(b))) }
    this.recorder.onerror = () => { useLiveStudio.setState({ status: 'The browser live encoder stopped.' }); void this.stop() }
    this.stopped = false
    this.recorder.start(250)
    this.interval = setInterval(() => this.draw(config.width, config.height), Math.max(15, Math.round(1000 / config.fps)))
    useLiveStudio.setState({ status: 'Encoder started. Waiting for the streaming server…' })
  }

  private draw(width: number, height: number) {
    const c = this.ctx
    c.fillStyle = '#070707'
    c.fillRect(0, 0, width, height)
    const filters: Record<LiveLook, string> = { clean: 'none', cinema: 'contrast(1.14) saturate(.88)', warm: 'sepia(.16) saturate(1.12)', mono: 'grayscale(1) contrast(1.08)' }
    c.filter = filters[this.look]
    if (this.transition) {
      const progress = Math.min(1, Math.max(0, (performance.now() - this.transition.start) / this.transition.duration))
      const levels = new Map<string, number>()
      for (const id of this.cameras.keys()) {
        const from = this.transition.from.get(id) ?? 0
        const to = this.transition.to.get(id) ?? 0
        levels.set(id, from + (to - from) * progress)
      }
      this.cameraLevels = levels
      if (progress >= 1) { this.cameraLevels = this.transition.to; this.transition = null }
    }
    const drawCamera = (id: string, opacity = 1) => {
      const camera = this.cameras.get(id)?.element
      if (!camera || camera.readyState !== HTMLMediaElement.HAVE_ENOUGH_DATA) return
      const scale = Math.max(width / camera.videoWidth, height / camera.videoHeight)
      const w = camera.videoWidth * scale
      const h = camera.videoHeight * scale
      c.globalAlpha = opacity
      c.drawImage(camera, (width - w) / 2, (height - h) / 2, w, h)
      c.globalAlpha = 1
    }
    const totalLevel = [...this.cameraLevels.values()].reduce((sum, level) => sum + level, 0)
    const normalize = Math.max(1, totalLevel)
    c.globalCompositeOperation = 'lighter'
    for (const [id, level] of this.cameraLevels) if (level > 0) drawCamera(id, level / normalize)
    c.globalCompositeOperation = 'source-over'
    c.filter = 'none'
    for (const overlay of this.overlays) {
      const { image, width: iw, height: ih } = overlay
      const scale = Math.min(width * 0.8 / iw, height * 0.8 / ih) * overlay.scale
      const w = iw * scale; const h = ih * scale
      try { c.drawImage(image, width * overlay.x - w / 2, height * overlay.y - h / 2, w, h) } catch { /* Wait until the first video frame is decoded. */ }
    }
    if (this.title) {
      c.font = `600 ${Math.max(28, Math.round(height * 0.055))}px sans-serif`
      c.textAlign = 'center'; c.textBaseline = 'bottom'
      c.lineWidth = Math.max(3, height * 0.006); c.strokeStyle = 'rgba(0,0,0,.8)'; c.fillStyle = '#fff'
      c.strokeText(this.title, width / 2, height * 0.93, width * 0.9)
      c.fillText(this.title, width / 2, height * 0.93, width * 0.9)
    }
  }

  async startLocalRecording() {
    if (!desktop || !this.localOutput) throw new Error('Iniciá el programa en vivo antes de grabar.')
    const exportApi = desktop.export
    if (this.localRecorder?.state === 'recording') return this.localFile?.path ?? null
    const handle = await exportApi.begin({ defaultName: `Faro-vivo-${new Date().toISOString().replace(/[:.]/g, '-')}`, extension: 'webm', filterName: 'Video WebM' })
    if (!handle) return null
    const mimeType = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'].find((type) => MediaRecorder.isTypeSupported(type))
    if (!mimeType) { await exportApi.abort(handle.id); throw new Error('Este equipo no ofrece un formato WebM compatible.') }
    const recorder = new MediaRecorder(this.localOutput, { mimeType, videoBitsPerSecond: 8_000_000, audioBitsPerSecond: 192_000 })
    this.localFile = { id: handle.id, path: handle.path }
    this.localPosition = 0
    this.localWrites = Promise.resolve()
    this.localWriteError = null
    recorder.ondataavailable = (event) => {
      if (!event.data.size || !this.localFile) return
      const id = this.localFile.id
      const position = this.localPosition
      this.localPosition += event.data.size
      this.localWrites = this.localWrites.then(async () => {
        const bytes = new Uint8Array(await event.data.arrayBuffer())
        await exportApi.write(id, position, bytes)
      }).catch((error: unknown) => { this.localWriteError = error })
    }
    recorder.onerror = () => { this.localWriteError = new Error('Falló la grabación local del vivo.') }
    this.localRecorder = recorder
    recorder.start(1000)
    return handle.path
  }

  stopLocalRecording(): Promise<string | null> {
    if (this.localStopPromise) return this.localStopPromise
    const recorder = this.localRecorder
    const file = this.localFile
    if (!recorder || !file) return Promise.resolve(null)
    this.localStopPromise = new Promise<string | null>((resolve, reject) => {
      recorder.addEventListener('stop', () => {
        void (async () => {
          await this.localWrites
          this.localRecorder = null
          this.localFile = null
          this.localStopPromise = null
          if (this.localWriteError) {
            await desktop?.export.abort(file.id)
            throw this.localWriteError
          }
          return (await desktop!.export.finish(file.id)).path
        })().then(resolve, reject)
      }, { once: true })
      recorder.stop()
    })
    return this.localStopPromise
  }

  async stop(callEncoder = true) {
    if (this.stopped) return
    this.stopped = true
    if (this.interval) clearInterval(this.interval)
    this.interval = null
    this.statusUnsub?.(); this.statusUnsub = null
    if (this.localRecorder && this.localRecorder.state !== 'inactive') await this.stopLocalRecording().catch(() => {})
    if (this.recorder && this.recorder.state !== 'inactive') this.recorder.stop()
    this.recorder = null
    for (const camera of this.cameras.values()) camera.stream.getTracks().forEach((t) => t.stop())
    this.cameras.clear()
    this.cameraLevels.clear()
    for (const channel of this.microphones.values()) { channel.stream.getTracks().forEach((t) => t.stop()); channel.gain.disconnect() }
    this.microphones.clear()
    for (const gains of this.soundGains.values()) for (const gain of gains) gain.disconnect()
    this.soundGains.clear()
    for (const audio of this.overlayAudio.values()) { audio.gain.disconnect(); audio.source.disconnect() }
    this.overlayAudio.clear()
    await this.audioContext?.suspend().catch(() => {}); this.audioContext = null; this.destination = null; this.localOutput = null
    if (callEncoder) await desktop?.live.stop().catch(() => {})
    useLiveStudio.setState({ program: null, status: '' })
  }
}
