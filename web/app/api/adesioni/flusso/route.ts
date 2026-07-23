import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { getAdesioniConfig } from '@/lib/adesioni/serverConfig'
import { loadFlussoFromBuffer } from '@/lib/adesioni/flusso'

export const runtime = 'nodejs'

// Carica un flusso Excel AXA e restituisce intestazioni, righe e record mappati.
export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const form = await req.formData()
  const file = form.get('file')
  if (!(file instanceof File)) return NextResponse.json({ error: 'File mancante' }, { status: 400 })

  try {
    const buf = Buffer.from(await file.arrayBuffer())
    const config = await getAdesioniConfig()
    const result = await loadFlussoFromBuffer(buf, config)
    return NextResponse.json(result)
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message || 'Errore lettura flusso' }, { status: 400 })
  }
}
