import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { getJobFiles, getOcrCache, hashPdfBase64 } from '@/lib/polizzaJobStore'
import { getSettings } from '@/lib/settingsStore'

export const runtime = 'nodejs'

// DIAGNOSTICA in sola lettura: il testo che il motore ha letto per i documenti
// di un job, come sta nella CACHE OCR (nessuna lettura nuova, nessun OCR). Serve
// a rigiocare offline le regole sulle posizioni SCANSIONATE, il cui testo
// (Tesseract o modello visivo) non esiste fuori dal server. Per ogni file la
// prima voce trovata tra: motore visivo con pagine «sandwich», motore visivo,
// sandwich, testo semplice (le chiavi di ocrCacheKey). Lavoro condiviso: stesso
// accesso della route che serve il PDF originale.
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession()
  if (!session.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const settings: any = await getSettings().catch(() => ({}))
  const engine = String(settings?.polizzaOcrEngine || '').trim()
  const files = await getJobFiles(params.id)
  const out = []
  for (const f of files) {
    const hash = f.file_hash || hashPdfBase64(f.pdf_base64)
    const keys = [
      ...(engine && engine.toLowerCase() !== 'tesseract' ? [`${hash}:vis:${engine}:sw`, `${hash}:vis:${engine}`] : []),
      `${hash}:sw`, hash,
    ]
    let hit: { key: string; pages: string[] } | null = null
    for (const key of keys) {
      const pages = await getOcrCache(key).catch(() => null)
      if (pages) { hit = { key: key.slice(hash.length) || '(testo)', pages }; break }
    }
    out.push({ idx: f.idx, file: f.file_name, cache: hit ? hit.key : null, pages: hit ? hit.pages : null })
  }
  return NextResponse.json({ jobId: params.id, files: out })
}
