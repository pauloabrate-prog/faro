import { ArrowDown, ArrowUp, Check, LoaderCircle, Plus, RotateCcw, Sparkles, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/select'
import { useEditor } from '@/editor/store'
import type { Asset } from '@/editor/types'
import { usePlayback } from '@/editor/playback'
import { dispatch, getProject } from '@/editor/store'
import { desktop } from '@/lib/platform'
import { loadModels, PROVIDERS, setTarget, useAi } from '@/integrations/ai'
import { useCopilot } from '@/features/copilot/store'
import { generateImage, generateVideo, loadGenModels, openIntegrations, useGenModels } from '@/integrations/store'
import { cn } from '@/lib/cn'
import { useUI } from '@/editor/ui-store'
import { draftStoryboard, type StoryboardDraft, type StoryboardScene } from './storyboard'

const MODEL_OPTIONS = [
  { value: 'landscape', label: '16:9 · Horizontal' },
  { value: 'vertical', label: '9:16 · Vertical' },
  { value: 'square', label: '1:1 · Cuadrado' },
]

function escapeXml(text: string) {
  return text.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char]!)
}

function panelSvg(scene: StoryboardScene, style: string, aspect: StoryboardDraft['aspect']) {
  const [width, height] = aspect === '9:16' ? [720, 1280] : aspect === '1:1' ? [960, 960] : [1280, 720]
  const title = escapeXml(scene.title.slice(0, 80))
  const description = escapeXml(scene.description.slice(0, 260))
  const visual = escapeXml(scene.visualPrompt.slice(0, 300))
  const look = escapeXml(style.slice(0, 100))
  const lines = description.match(/.{1,58}(?:\s|$)/g)?.slice(0, 3).map((line, i) => `<text x="72" y="${height - 154 + i * 25}" fill="#d9e2e8" font-size="18" font-family="Arial,sans-serif">${line.trim()}</text>`).join('') ?? ''
  const promptLines = visual.match(/.{1,48}(?:\s|$)/g)?.slice(0, 4).map((line, i) => `<text x="72" y="${height - 66 + i * 19}" fill="#94a3ad" font-size="13" font-family="Arial,sans-serif">${line.trim()}</text>`).join('') ?? ''
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><defs><linearGradient id="g" x2="1" y2="1"><stop stop-color="#1a2934"/><stop offset="1" stop-color="#0b1015"/></linearGradient><radialGradient id="r"><stop stop-color="#527082" stop-opacity=".48"/><stop offset="1" stop-color="#527082" stop-opacity="0"/></radialGradient></defs><rect width="${width}" height="${height}" fill="url(#g)"/><ellipse cx="${width * 0.62}" cy="${height * 0.42}" rx="${width * 0.48}" ry="${height * 0.44}" fill="url(#r)"/><path d="M70 ${height * 0.62} Q${width * 0.32} ${height * 0.2} ${width * 0.5} ${height * 0.52} T${width - 70} ${height * 0.34}" fill="none" stroke="#9edbea" stroke-opacity=".48" stroke-width="3"/><rect x="42" y="42" width="${width - 84}" height="${height - 84}" rx="18" fill="none" stroke="#d6ee00" stroke-opacity=".42" stroke-width="2" stroke-dasharray="10 10"/><text x="72" y="82" fill="#d6ee00" font-size="15" letter-spacing="3" font-family="Arial,sans-serif">STORYBOARD · REFERENCIA VISUAL</text><text x="72" y="${height * 0.21}" fill="#ffffff" font-size="42" font-weight="700" font-family="Arial,sans-serif">${title}</text><text x="72" y="${height * 0.27}" fill="#b8c5cd" font-size="17" font-family="Arial,sans-serif">${look}</text>${lines}${promptLines}<text x="${width - 75}" y="82" text-anchor="end" fill="#d6ee00" font-size="16" font-family="Arial,sans-serif">PENDIENTE DE GENERAR</text></svg>`
}

async function makeStoryboardFile(scene: StoryboardScene, style: string, aspect: StoryboardDraft['aspect'], index: number) {
  if (!desktop) throw new Error('Las tarjetas de storyboard requieren la aplicación de escritorio.')
  const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const fileName = `storyboard-${unique}-${String(index + 1).padStart(2, '0')}.svg`
  const saved = await desktop.files.saveMedia('generated', fileName, new TextEncoder().encode(panelSvg(scene, style, aspect)))
  const [width, height] = aspect === '9:16' ? [720, 1280] : aspect === '1:1' ? [960, 960] : [1280, 720]
  return {
    id: `storyboard-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 7)}`,
    name: `Storyboard · ${scene.title}`,
    kind: 'image' as const,
    width,
    height,
    source: { type: 'file' as const, url: saved.url, path: saved.path, mime: 'image/svg+xml', fileName: saved.name, size: saved.size, mtime: saved.mtime },
    generated: true,
    tags: ['storyboard', 'reference'],
    provenance: { integration: 'storyboard', tool: 'text-plan', prompt: scene.visualPrompt, params: { description: scene.description, narration: scene.narration, style, aspect } },
    addedAt: Date.now(),
  }
}

export function StoryboardPanel() {
  const providers = useAi((s) => s.providers)
  const models = useAi((s) => s.models)
  const target = useAi((s) => s.target)
  const providerModels = useGenModels((s) => s.models)
  const configuredProviders = useAi((s) => s.providers)
  const busyCopilot = useCopilot((s) => s.busy)
  const [idea, setIdea] = useState('')
  const [audience, setAudience] = useState('')
  const [style, setStyle] = useState('')
  const [aspect, setAspect] = useState<StoryboardDraft['aspect']>('16:9')
  const [sceneCount, setSceneCount] = useState(6)
  const [seconds, setSeconds] = useState(5)
  const [busy, setBusy] = useState(false)
  const [draft, setDraft] = useState<StoryboardDraft | null>(null)
  const [applying, setApplying] = useState(false)
  const [mediaProvider, setMediaProvider] = useState<'openai' | 'gemini'>('openai')
  const readyModels = useMemo(() => PROVIDERS.flatMap((provider) => {
    if (!providers[provider.id]?.configured || provider.local) return []
    return (models[provider.id]?.models ?? []).map((model) => ({ value: `${provider.id}/${model.id}`, label: `${provider.name} · ${model.name}` }))
  }), [providers, models])
  const chosenTextModel = target?.kind === 'model' && readyModels.some((option) => option.value === `${target.provider}/${target.model}`)
    ? `${target.provider}/${target.model}`
    : readyModels[0]?.value ?? ''
  const selectedModel = Boolean(chosenTextModel)
  const mediaModels = useMemo(() => (['openai', 'gemini'] as const).flatMap((provider) =>
    configuredProviders[provider]?.configured ? [
      ...(providerModels[provider]?.image ?? []).map((model) => ({ value: JSON.stringify({ provider, kind: 'image', model }), label: `${provider === 'openai' ? 'OpenAI' : 'Google'} · imagen · ${model}` })),
      ...(providerModels[provider]?.video ?? []).map((model) => ({ value: JSON.stringify({ provider, kind: 'video', model }), label: `${provider === 'openai' ? 'OpenAI' : 'Google'} · video · ${model}` })),
    ] : [],
  ), [configuredProviders, providerModels])

  useEffect(() => {
    for (const provider of PROVIDERS) {
      if (providers[provider.id]?.configured && !provider.local && !models[provider.id]) void loadModels(provider.id)
    }
    if (providers.openai?.configured) void loadGenModels('openai')
    if (providers.gemini?.configured) void loadGenModels('gemini')
  }, [providers, models])

  const generate = async () => {
    if (busy || busyCopilot) return
    setBusy(true)
    try {
      const [provider, model] = chosenTextModel.split('/')
      if (!provider || !model) throw new Error('Conectá un modelo de texto en Integraciones.')
      setTarget({ kind: 'model', provider: provider as import('@shared/ai').ProviderId, model })
      setDraft(await draftStoryboard({ idea, audience, style, aspect, sceneCount, secondsPerScene: seconds }))
    } catch (err) {
      toast.error('No se pudo crear el storyboard', { description: err instanceof Error ? err.message : String(err) })
    } finally {
      setBusy(false)
    }
  }

  const generateSceneMedia = async (scene: StoryboardScene, selection: string) => {
    if (!desktop) return void toast.error('La generación requiere la aplicación de escritorio.')
    let parsed: { provider: string; kind: string; model: string }
    try { parsed = JSON.parse(selection) as typeof parsed } catch { return void openIntegrations('ai-models') }
    const { provider, kind, model } = parsed
    if ((provider !== 'openai' && provider !== 'gemini') || (kind !== 'image' && kind !== 'video') || !model) return void openIntegrations('ai-models')
    try {
      if (kind === 'image') await generateImage({ provider, model, prompt: scene.visualPrompt, aspect: draft?.aspect ?? '16:9' })
      else await generateVideo({ provider, model, prompt: scene.visualPrompt, aspect: (draft?.aspect === '1:1' ? '16:9' : draft?.aspect) ?? '16:9', seconds: scene.durationSeconds })
      toast.success(`Generación de ${kind === 'image' ? 'imagen' : 'video'} iniciada`, { description: 'Al terminar se agrega a Media; arrastrala a la escena cuando quieras reemplazar la tarjeta.' })
    } catch (err) {
      toast.error('No se pudo iniciar la generación', { description: err instanceof Error ? err.message : String(err) })
    }
  }

  const updateScene = (id: string, patch: Partial<StoryboardScene>) => setDraft((d) => d && ({
    ...d,
    scenes: d.scenes.map((scene) => scene.id === id ? { ...scene, ...patch } : scene),
  }))

  const moveScene = (id: string, delta: -1 | 1) => setDraft((d) => {
    if (!d) return d
    const from = d.scenes.findIndex((scene) => scene.id === id)
    const to = from + delta
    if (from < 0 || to < 0 || to >= d.scenes.length) return d
    const scenes = [...d.scenes]
    ;[scenes[from], scenes[to]] = [scenes[to], scenes[from]]
    return { ...d, scenes }
  })

  const applyDraft = async () => {
    if (!draft || applying) return
    const scenes = draft.scenes.filter((scene) => scene.selected)
    if (!scenes.length) return void toast('Elegí al menos una escena para agregar.')
    setApplying(true)
    try {
      const referenceAssets: Asset[] = []
      for (const [index, scene] of scenes.entries()) {
        const asset = await makeStoryboardFile(scene, draft.style, draft.aspect, index)
        referenceAssets.push(asset)
      }
      useEditor.getState().transaction(`Storyboard: ${draft.title}`, 'user', () => {
        let titles = getProject().tracks.find((t) => t.role === 'titles' && !t.locked)
        if (!titles) {
          const result = dispatch('track.add', { kind: 'video', name: 'Títulos storyboard', role: 'titles', index: 0 })
          if (!result.ok) throw new Error(result.error)
          titles = getProject().tracks.find((t) => t.id === result.result)
        }
        let main = getProject().tracks.find((t) => t.role === 'main' && !t.locked)
        if (!main) {
          const result = dispatch('track.add', { kind: 'video', name: 'Storyboard', role: 'main' })
          if (!result.ok) throw new Error(result.error)
          main = getProject().tracks.find((t) => t.id === result.result)
        }
        if (!main) throw new Error('No encontré una pista de video disponible.')
        let frame = Math.max(0, usePlayback.getState().frame)
        const fps = getProject().settings.fps
        const height = getProject().settings.height
        for (const [index, scene] of scenes.entries()) {
          const duration = Math.max(1, Math.round(scene.durationSeconds * fps))
          const asset = referenceAssets[index]
          const mediaId = asset.id
          const registered = dispatch('asset.add', { asset })
          if (!registered.ok) throw new Error(registered.error)
          const placed = dispatch('clip.add', {
            trackId: main.id,
            kind: 'image',
            assetId: mediaId,
            start: frame,
            duration,
            name: scene.title,
          })
          if (!placed.ok) throw new Error(placed.error)
          const width = getProject().settings.width
          const title = dispatch('clip.add', {
            trackId: titles?.id ?? main.id,
            kind: 'text',
            start: frame,
            duration,
            name: scene.title,
            patch: { text: { content: scene.title, size: Math.max(40, Math.round(Math.min(width, height) * 0.065)), align: 'center', font: 'sans', weight: 700, color: '#ffffff', letterSpacing: 0, lineHeight: 1.1, uppercase: false, italic: false, background: null, shadow: 0.35, glow: null, extrude: 0, material: 'chrome', bevel: true }, transform: { y: Math.round(height * 0.3) } },
          })
          if (!title.ok) throw new Error(title.error)
          frame += duration
        }
      })
      useUI.getState().select(Object.values(getProject().clips).slice(-scenes.length * 2).map((clip) => clip.id))
      useUI.getState().requestFit()
      toast.success(`${scenes.length} escenas agregadas a la línea de tiempo`, { description: 'Las tarjetas de referencia y sus prompts quedaron guardados dentro del proyecto.' })
    } catch (err) {
      toast.error('No se pudo aplicar el storyboard', { description: err instanceof Error ? err.message : String(err) })
    } finally {
      setApplying(false)
    }
  }

  const optionAspect = MODEL_OPTIONS.find((o) => o.value === aspect)?.value ?? 'landscape'

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="space-y-3 px-3.5 pb-4 pt-2">
        <div className="rounded-xl bg-ai/5 p-3 shadow-[inset_0_0_0_1px_rgb(94_242_166/0.16)]">
          <div className="flex items-center gap-2 text-sm font-semibold text-fg"><Sparkles className="size-4 text-ai" />Storyboard con IA</div>
          <p className="mt-1.5 text-xs leading-relaxed text-fg-3">Convertí una idea o guion en escenas con continuidad visual. Revisalas acá antes de llevarlas a la secuencia.</p>
        </div>
        <div className="rounded-lg bg-white/[0.025] px-2.5 py-2 text-[10px] leading-relaxed text-fg-4">Usa tus propias cuentas de IA. El proveedor puede cobrar por cada generación según tu plan; el editor no procesa pagos.</div>
        {readyModels.length > 0 ? <Select aria-label="Modelo para planificar" value={chosenTextModel} onChange={(value) => { const [provider, model] = value.split('/'); if (provider && model) setTarget({ kind: 'model', provider: provider as import('@shared/ai').ProviderId, model }) }} size="md" className="w-full" options={readyModels} /> : <button type="button" onClick={() => openIntegrations('ai-models')} className="w-full rounded-lg bg-white/[0.04] px-2.5 py-2 text-left text-xs text-fg-3">Conectar modelo de texto en Integraciones →</button>}

        <div className="rounded-lg bg-white/[0.035] p-2.5">
          <div className="mb-1 text-xs font-medium text-fg-3">Idea o guion</div>
          <textarea value={idea} onChange={(event) => setIdea(event.target.value)} rows={5} maxLength={12000} placeholder="Ej.: una artesana prepara un mate de madera desde el primer corte hasta el acabado final…" className="w-full resize-y bg-transparent text-sm leading-relaxed text-fg outline-none placeholder:text-fg-4" />
        </div>
        <input value={audience} onChange={(event) => setAudience(event.target.value)} maxLength={160} placeholder="Público (opcional)" className="w-full rounded-lg bg-white/[0.04] px-2.5 py-2 text-xs text-fg outline-none placeholder:text-fg-4" />
        <input value={style} onChange={(event) => setStyle(event.target.value)} maxLength={180} placeholder="Estilo visual (opcional): documental cálido, animación…" className="w-full rounded-lg bg-white/[0.04] px-2.5 py-2 text-xs text-fg outline-none placeholder:text-fg-4" />
        <Select aria-label="Formato del video" value={optionAspect} onChange={(value) => setAspect(value === 'vertical' ? '9:16' : value === 'square' ? '1:1' : '16:9')} size="md" className="w-full" options={MODEL_OPTIONS} />

        <div className="flex items-center justify-between gap-3 rounded-lg bg-white/[0.025] px-2.5 py-2">
          <span className="text-xs text-fg-3">Escenas</span>
          <div className="flex gap-1">{[4, 6, 8, 10].map((count) => <button type="button" key={count} onClick={() => setSceneCount(count)} className={cn('rounded-md px-2 py-1 text-xs tabular', count === sceneCount ? 'bg-white/10 text-fg' : 'text-fg-4 hover:text-fg-2')}>{count}</button>)}</div>
        </div>
        <div className="flex items-center justify-between gap-3 rounded-lg bg-white/[0.025] px-2.5 py-2">
          <span className="text-xs text-fg-3">Segundos por escena</span>
          <div className="flex gap-1">{[3, 5, 8].map((n) => <button type="button" key={n} onClick={() => setSeconds(n)} className={cn('rounded-md px-2 py-1 text-xs tabular', n === seconds ? 'bg-white/10 text-fg' : 'text-fg-4 hover:text-fg-2')}>{n}s</button>)}</div>
        </div>

        <Button variant="ai" size="lg" className="w-full" disabled={busy || applying || !idea.trim() || !selectedModel || busyCopilot} onClick={() => void generate()}>
          {busy ? <LoaderCircle className="animate-spin" /> : <Sparkles />}{busy ? 'Armando escenas…' : 'Crear storyboard'}
        </Button>
        {!selectedModel && <p className="text-center text-[11px] leading-relaxed text-fg-4">Conectá un modelo de texto para generar el borrador.</p>}
        {busyCopilot && <p className="text-center text-[11px] text-fg-4">Esperá a que termine la respuesta actual del Copilot.</p>}

        {draft && (
          <section className="space-y-2 border-t border-line pt-3">
            <div>
              <div className="text-sm font-semibold text-fg">{draft.title}</div>
              {draft.style && <div className="mt-0.5 text-[11px] text-fg-4">{draft.style}</div>}
              <div className="mt-1 text-[11px] text-fg-4">{draft.scenes.filter((scene) => scene.selected).length} de {draft.scenes.length} escenas seleccionadas</div>
            </div>
            {draft.scenes.map((scene, index) => (
              <article key={scene.id} className={cn('rounded-xl p-2.5 shadow-[inset_0_0_0_1px_rgb(255_255_255/0.06)]', scene.selected ? 'bg-white/[0.035]' : 'bg-black/10 opacity-60')}>
                <div className="flex items-start gap-2">
                  <button type="button" aria-label={scene.selected ? 'Quitar escena' : 'Seleccionar escena'} onClick={() => updateScene(scene.id, { selected: !scene.selected })} className={cn('mt-0.5 grid size-4 shrink-0 place-items-center rounded border', scene.selected ? 'border-accent bg-accent text-black' : 'border-fg-4 text-transparent')}><Check className="size-3" /></button>
                  <div className="min-w-0 flex-1">
                    <input value={scene.title} onChange={(event) => updateScene(scene.id, { title: event.target.value })} maxLength={120} aria-label={`Título de escena ${index + 1}`} className="w-full bg-transparent text-xs font-semibold text-fg outline-none" />
                    <div className="mt-1 flex gap-1">
                      <button type="button" disabled={index === 0} onClick={() => moveScene(scene.id, -1)} className="grid size-6 place-items-center rounded bg-white/[0.045] text-fg-3 disabled:opacity-30" aria-label="Mover escena arriba"><ArrowUp className="size-3.5" /></button>
                      <button type="button" disabled={index === draft.scenes.length - 1} onClick={() => moveScene(scene.id, 1)} className="grid size-6 place-items-center rounded bg-white/[0.045] text-fg-3 disabled:opacity-30" aria-label="Mover escena abajo"><ArrowDown className="size-3.5" /></button>
                      <button type="button" onClick={() => setDraft((d) => d && ({ ...d, scenes: d.scenes.filter((item) => item.id !== scene.id) }))} className="grid size-6 place-items-center rounded bg-white/[0.045] text-fg-3 hover:text-danger" aria-label="Eliminar escena"><Trash2 className="size-3.5" /></button>
                    </div>
                    <textarea value={scene.description} onChange={(event) => updateScene(scene.id, { description: event.target.value })} rows={2} aria-label={`Descripción de escena ${index + 1}`} className="mt-2 w-full resize-y bg-transparent text-[11px] leading-relaxed text-fg-2 outline-none" />
                    <textarea value={scene.visualPrompt} onChange={(event) => updateScene(scene.id, { visualPrompt: event.target.value })} rows={2} aria-label={`Prompt visual de escena ${index + 1}`} placeholder="Prompt para generar la imagen o el clip…" className="mt-1 w-full resize-y rounded-md bg-black/15 p-1.5 text-[10px] leading-relaxed text-fg-3 outline-none placeholder:text-fg-4" />
                    {scene.narration && <div className="mt-1 text-[10px] leading-relaxed text-fg-4">Voz: {scene.narration}</div>}
                    <div className="mt-1 text-[10px] text-fg-4">{scene.durationSeconds}s · {draft.aspect}</div>
                    {mediaModels.length > 0 ? <div className="mt-1.5 flex items-center gap-1.5">
                      <Select aria-label="Modelo para generar medios" value={mediaModels.find((item) => { const parsed = JSON.parse(item.value) as { provider: string }; return parsed.provider === mediaProvider })?.value ?? mediaModels[0].value} onChange={(value) => { const parsed = JSON.parse(value) as { provider: string }; if (parsed.provider === 'openai' || parsed.provider === 'gemini') setMediaProvider(parsed.provider) }} size="sm" className="min-w-0 flex-1" options={mediaModels} />
                      {(['image', 'video'] as const).map((kind) => { const choice = mediaModels.find((item) => { const parsed = JSON.parse(item.value) as { provider: string; kind: string }; return parsed.provider === mediaProvider && parsed.kind === kind }); return <Button key={kind} size="sm" variant="secondary" disabled={!choice} onClick={() => choice && void generateSceneMedia(scene, choice.value)}>{kind === 'image' ? 'Imagen' : 'Video'}</Button> })}
                    </div> : <button type="button" onClick={() => openIntegrations('ai-models')} className="mt-1 text-[10px] text-accent-2">Conectá OpenAI o Google para generar esta escena</button>}
                  </div>
                </div>
              </article>
            ))}
            <Button size="lg" className="w-full" disabled={applying || !draft.scenes.some((scene) => scene.selected)} onClick={() => void applyDraft()}>
              {applying ? <LoaderCircle className="animate-spin" /> : <Plus />}{applying ? 'Agregando…' : 'Agregar escenas a la línea de tiempo'}
            </Button>
            <Button size="md" variant="ghost" className="w-full" disabled={busy || applying} onClick={() => void generate()}><RotateCcw />Generar otra versión</Button>
            <p className="text-center text-[10px] leading-relaxed text-fg-4">Las tarjetas son referencias editables; al terminar la generación, el resultado aparece en Media para que lo pongas en la pista.</p>
          </section>
        )}
      </div>
    </div>
  )
}
