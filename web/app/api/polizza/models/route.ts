import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { getSettings } from '@/lib/settingsStore'

export const runtime = 'nodejs'

// Modelli disponibili sul server Ollama configurato (per il datalist del dialog
// di test). In caso di errore risponde lista vuota: il campo resta free-text.
export async function GET() {
  const session = await getSession()
  if (!session.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    const settings = await getSettings()
    const url = settings.ollamaUrl || 'http://127.0.0.1:11434'
    const res = await fetch(`${url}/api/tags`, { signal: AbortSignal.timeout(5000) })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const models: string[] = ((await res.json())?.models || []).map((m: any) => String(m?.name || '')).filter(Boolean)
    return NextResponse.json({ models })
  } catch {
    return NextResponse.json({ models: [] })
  }
}
