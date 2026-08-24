import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { getSettings, saveSettings, WebSettings } from '@/lib/settingsStore'
import { logAction } from '@/lib/logger'

export async function GET() {
  const session = await getSession()
  if (!session.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const s = await getSettings()
  // Solo Ollama: nessuna API key cloud da esporre.
  return NextResponse.json(s)
}

export async function POST(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for') ?? 'unknown'
  const session = await getSession()
  if (!session.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = (await req.json()) as Partial<WebSettings>
  const current = await getSettings()

  // Campi consentiti (whitelist). I segreti non vengono sovrascritti se arriva il placeholder ***.
  const allowed: (keyof WebSettings)[] = [
    // Solo Ollama: chiavi OpenAI/Anthropic rimosse dalla whitelist.
    'llmProvider', 'llmModel', 'ollamaUrl', 'ollamaModel', 'ollamaVisionModel',
    'polizzaOcrEnabled', 'polizzaWholeDossier',
    'polizzaWholeDossierModel', 'polizzaPerField', 'polizzaConstrainedJson', 'polizzaPromptExtra', 'polizzaFields', 'polizzaProfiles',
    // DEMO "Usa modello Claude": toggle + credenziali/modello Anthropic per la presentazione.
    'polizzaUseClaude', 'anthropicApiKey', 'anthropicModel',
    'polizzaVerificaCampi', 'polizzaVerificaModel', 'polizzaConsensusPasses',
    // Strategia motore a stadi (gruppi/cascata): senza questa chiave in whitelist
    // il salvataggio la SCARTAVA in silenzio e lo switch tornava sempre a gruppi.
    'polizzaStagedCascade',
    // Pre-check di pertinenza profilo↔fascicolo (off/keywords/semantic/llm).
    'polizzaPrecheckMode',
    'extractions', 'profiles', 'bulkExcludedFolderNames', 'bulkIncludeKeywords', 'bulkExcludeKeywords',
    'qdrantUrl', 'qdrantApiKey', 'qdrantCollection', 'embeddingModel',
    'compareMatchKeys', 'compareFuzzyEnabled', 'compareFuzzyMinOverlap', 'compareFuzzyIgnoreWords',
    'compareFuzzyBroadEnabled', 'compareFuzzyMinOverlapBroad', 'compareSearchConditions', 'compareBothMatchConditions',
    'compareBothFilterConditions', 'compareProfiles', 'compareBothProfiles',
    'adesioniFields', 'adesioniIdd', 'adesioniPrezzi', 'adesioniDateOffsetDays',
    'adesioniExportNotify', 'adesioniSmtp', 'adesioniFtpStaging', 'adesioniFtpProd', 'adesioniProfiles',
    'adesioniTemplateId', 'adesioniTemplateHtml', 'adesioniAttachments',
    'theme', 'language', 'accentColor',
  ]
  const update: Partial<WebSettings> = {}
  for (const k of allowed) {
    if (body[k] !== undefined) (update as Record<string, unknown>)[k] = body[k]
  }
  void current

  await saveSettings(update)
  await logAction({ email: session.email, action: 'settings.save', ip })

  return NextResponse.json({ ok: true })
}
