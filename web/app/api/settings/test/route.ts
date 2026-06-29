import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { getSettings } from '@/lib/settingsStore'
import { logAction } from '@/lib/logger'

export async function POST(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for') ?? 'unknown'
  const session = await getSession()
  if (!session.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Use submitted settings (with fallback to stored)
  const body = await req.json().catch(() => ({}))
  const stored = getSettings()
  const settings = {
    llmProvider: body.llmProvider ?? stored.llmProvider,
    ollamaUrl: body.ollamaUrl ?? stored.ollamaUrl,
    openaiApiKey: body.openaiApiKey && body.openaiApiKey !== '***' ? body.openaiApiKey : stored.openaiApiKey,
    anthropicApiKey: body.anthropicApiKey && body.anthropicApiKey !== '***' ? body.anthropicApiKey : stored.anthropicApiKey,
    llmModel: body.llmModel ?? stored.llmModel,
  }

  try {
    const { testProviderConnection } = await import('@/lib/llmAdapter')
    const result = await testProviderConnection(settings)
    logAction({ email: session.email, action: 'settings.test_connection', ip, metadata: { provider: settings.llmProvider, ok: result.ok } })
    return NextResponse.json(result)
  } catch (err) {
    return NextResponse.json({ ok: false, message: String(err) }, { status: 500 })
  }
}
