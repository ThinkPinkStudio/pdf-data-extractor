import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { getSettings, saveSettings, WebSettings } from '@/lib/settingsStore'
import { logAction } from '@/lib/logger'

export async function GET() {
  const session = await getSession()
  if (!session.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const s = await getSettings()
  // Never return secrets to client (only whether they are set)
  return NextResponse.json({
    ...s,
    openaiApiKey: s.openaiApiKey ? '***' : '',
    anthropicApiKey: s.anthropicApiKey ? '***' : '',
    voyageApiKey: s.voyageApiKey ? '***' : '',
  })
}

export async function POST(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for') ?? 'unknown'
  const session = await getSession()
  if (!session.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = (await req.json()) as Partial<WebSettings>
  const current = await getSettings()

  // Campi consentiti (whitelist). I segreti non vengono sovrascritti se arriva il placeholder ***.
  const allowed: (keyof WebSettings)[] = [
    'llmProvider', 'llmModel', 'ollamaUrl', 'openaiModel', 'anthropicModel', 'ollamaModel',
    'ollamaVisionModel', 'anthropicVisionModel', 'polizzaOcrEnabled', 'polizzaWholeDossier',
    'polizzaWholeDossierModel', 'polizzaPromptExtra', 'polizzaFields', 'polizzaProfiles',
    'polizzaVerificaCampi', 'polizzaVerificaModel', 'polizzaConsensusPasses',
    'extractions', 'profiles', 'bulkExcludedFolderNames',
    'embeddingProvider', 'embeddingModel', 'embeddingDim',
    'theme', 'language', 'accentColor',
  ]
  const update: Partial<WebSettings> = {}
  for (const k of allowed) {
    if (body[k] !== undefined) (update as Record<string, unknown>)[k] = body[k]
  }
  if (body.openaiApiKey && body.openaiApiKey !== '***') update.openaiApiKey = body.openaiApiKey
  if (body.anthropicApiKey && body.anthropicApiKey !== '***') update.anthropicApiKey = body.anthropicApiKey
  if (body.voyageApiKey && body.voyageApiKey !== '***') update.voyageApiKey = body.voyageApiKey
  // Mantieni i segreti esistenti se non aggiornati (no-op: già persistiti)
  void current

  await saveSettings(update)
  await logAction({ email: session.email, action: 'settings.save', ip })

  return NextResponse.json({ ok: true })
}
