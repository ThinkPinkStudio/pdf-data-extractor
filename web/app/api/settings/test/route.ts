import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { getSettings } from '@/lib/settingsStore'
import { logAction } from '@/lib/logger'

export async function POST(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for') ?? 'unknown'
  const session = await getSession()
  if (!session.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Solo Ollama (OpenAI/Anthropic rimossi dal prodotto).
  const body = await req.json().catch(() => ({}))
  const stored = await getSettings()
  const settings = {
    llmProvider: 'ollama',
    ollamaUrl: body.ollamaUrl ?? stored.ollamaUrl,
    llmModel: body.llmModel ?? stored.llmModel,
  }

  try {
    const { testProviderConnection } = await import('@/lib/llmAdapter')
    const result = await testProviderConnection(settings)
    await logAction({ email: session.email, action: 'settings.test_connection', ip, metadata: { provider: 'ollama', ok: result.ok } })
    return NextResponse.json(result)
  } catch (err) {
    return NextResponse.json({ ok: false, message: String(err) }, { status: 500 })
  }
}
