import { useAi } from '@/integrations/ai'
import { api } from '@/integrations/store'

export interface StoryboardScene {
  id: string
  title: string
  description: string
  narration: string
  visualPrompt: string
  durationSeconds: number
  selected: boolean
}

export interface StoryboardDraft {
  title: string
  style: string
  aspect: '16:9' | '9:16' | '1:1'
  scenes: StoryboardScene[]
}

export interface StoryboardRequest {
  idea: string
  audience?: string
  style?: string
  aspect?: StoryboardDraft['aspect']
  sceneCount?: number
  secondsPerScene?: number
}

/** Drafts a storyboard with the selected API model. This path has no editor tools or Copilot history. */
export async function draftStoryboard(request: StoryboardRequest): Promise<StoryboardDraft> {
  const target = useAi.getState().target
  if (!target || target.kind !== 'model') throw new Error('Para generar el storyboard elegí un modelo de IA conectado en el selector de Copilot.')
  if (!api) throw new Error('La generación de storyboard requiere la aplicación de escritorio.')
  const idea = request.idea.trim()
  if (!idea) throw new Error('Escribí una idea o pegá un guion para armar el storyboard.')
  const count = Math.round(Math.min(12, Math.max(2, request.sceneCount ?? 6)))
  const prompt = [
    'Creá un storyboard claro y realizable para un video. Escribí en español rioplatense. Conservá continuidad de personajes, espacio, vestuario y estilo entre escenas.',
    `Idea o guion: ${idea}`,
    request.audience ? `Público: ${request.audience}` : '',
    `Estilo visual: ${request.style?.trim() || 'elegilo según la idea y mantenelo coherente en todas las escenas'}`,
    `Formato: ${request.aspect ?? '16:9'}. Cantidad exacta de escenas: ${count}. Duración aproximada por escena: ${request.secondsPerScene ?? 5} segundos.`,
    'No incluyas texto ni letras dentro de visualPrompt; los títulos se añadirán como capas editables en el editor.',
    'Devolvé únicamente JSON válido, sin markdown: {"title":"título breve","style":"estilo visual","scenes":[{"title":"nombre de escena","description":"qué ocurre y qué se ve","narration":"voz o diálogo, vacío si no hace falta","visualPrompt":"prompt autónomo para generar este plano","durationSeconds":5}]}',
  ].filter(Boolean).join('\n\n')
  const raw = await api.ai.draftText({ target, prompt, system: 'Sos un guionista visual y director de fotografía. Respondés solamente en el formato solicitado. No llamás herramientas ni modificás proyectos.' })
  const json = raw.match(/\{[\s\S]*\}/)?.[0]
  if (!json) throw new Error('La IA no devolvió el storyboard en el formato esperado. Probá de nuevo o ajustá el pedido.')
  let value: Partial<{ title: string; style: string; scenes: unknown[] }>
  try { value = JSON.parse(json) as typeof value } catch { throw new Error('La respuesta de IA no era JSON válido. Probá de nuevo.') }
  if (!Array.isArray(value.scenes) || !value.scenes.length) throw new Error('La IA devolvió un storyboard sin escenas.')
  const scenes = value.scenes.slice(0, 12).map((item, index) => {
    const scene = item as Partial<Record<'title' | 'description' | 'narration' | 'visualPrompt', unknown>> & { durationSeconds?: unknown }
    return {
      id: `scene-${index + 1}`,
      title: typeof scene.title === 'string' && scene.title.trim() ? scene.title.trim() : `Escena ${index + 1}`,
      description: typeof scene.description === 'string' ? scene.description.trim() : '',
      narration: typeof scene.narration === 'string' ? scene.narration.trim() : '',
      visualPrompt: typeof scene.visualPrompt === 'string' ? scene.visualPrompt.trim() : '',
      durationSeconds: typeof scene.durationSeconds === 'number' && Number.isFinite(scene.durationSeconds)
        ? Math.min(30, Math.max(1, scene.durationSeconds))
        : request.secondsPerScene ?? 5,
      selected: true,
    } satisfies StoryboardScene
  })
  return {
    title: typeof value.title === 'string' && value.title.trim() ? value.title.trim() : 'Storyboard nuevo',
    style: typeof value.style === 'string' ? value.style.trim() : request.style ?? '',
    aspect: request.aspect ?? '16:9',
    scenes,
  }
}
