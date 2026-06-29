import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { getSettings, saveSettings } from '@/lib/settingsStore'
import { logAction } from '@/lib/logger'

export async function GET() {
  const session = await getSession()
  if (!session.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const s = await getSettings()
  // Never return secrets to client
  return NextResponse.json({
    llmProvider: s.llmProvider,
    llmModel: s.llmModel,
    ollamaUrl: s.ollamaUrl,
    openaiApiKey: s.openaiApiKey ? '***' : '',
    anthropicApiKey: s.anthropicApiKey ? '***' : '',
  })
}

export async function POST(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for') ?? 'unknown'
  const session = await getSession()
  if (!session.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()

  // Don't overwrite keys if placeholder sent
  const current = await getSettings()
  const update = {
    llmProvider: body.llmProvider ?? current.llmProvider,
    llmModel: body.llmModel ?? current.llmModel,
    ollamaUrl: body.ollamaUrl ?? current.ollamaUrl,
    openaiApiKey: body.openaiApiKey && body.openaiApiKey !== '***' ? body.openaiApiKey : current.openaiApiKey,
    anthropicApiKey: body.anthropicApiKey && body.anthropicApiKey !== '***' ? body.anthropicApiKey : current.anthropicApiKey,
  }

  await saveSettings(update)
  await logAction({ email: session.email, action: 'settings.save', ip })

  return NextResponse.json({ ok: true })
}
