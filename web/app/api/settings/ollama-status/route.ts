import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { ollamaStatus } from '@/lib/llmAdapter'
import { getSettings } from '@/lib/settingsStore'

export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const url = req.nextUrl.searchParams.get('url') || (await getSettings()).ollamaUrl
  return NextResponse.json(await ollamaStatus(url))
}
