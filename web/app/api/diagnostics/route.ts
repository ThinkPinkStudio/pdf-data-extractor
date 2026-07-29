import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { getSettings } from '@/lib/settingsStore'
import { importSharedService } from '@/lib/sharedServices'
import { ocrStatus } from '@/lib/polizzaService'

/* eslint-disable @typescript-eslint/no-explicit-any */

export async function GET() {
  const session = await getSession()
  if (!session.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const stored = await getSettings()
  const net = await importSharedService<any>('netDiagnostics.js')

  const system = {
    platform: process.platform,
    arch: process.arch,
    node: process.version,
    appVersion: process.env.NEXT_PUBLIC_APP_VERSION || '',
  }

  const ep = net.endpointForProvider(stored)
  const layers: Record<string, any> = {}
  try {
    if (ep.host) {
      const dns = await net.probeDns(ep.host)
      layers.dns = dns
      const ip = dns.ips?.[0]
      layers.tcp = await net.probeTcp(ep.host, ep.port, ip)
      layers.tls = await net.probeTls(ep.host, ep.port)
    }
    layers.http = await net.probeHttp(ep.url, ep.label === 'Anthropic' ? { method: 'POST', headers: {}, body: '{}' } : {})
  } catch (err) {
    layers.error = (err as Error).message
  }

  const ocr = await ocrStatus()

  // ─── Connessioni dei servizi: diagnostica PARLANTE, con suggerimento ────────
  // Ogni voce: { status: 'ok'|'warn'|'fail', detail } in italiano azionabile.
  const services: Record<string, { status: string; detail: string }> = {}
  const timeout = (ms: number) => AbortSignal.timeout(ms)

  // Ollama: raggiungibilità + presenza dei modelli configurati (testo + embeddings)
  const ollamaUrl = stored.ollamaUrl || 'http://127.0.0.1:11434'
  try {
    const res = await fetch(`${ollamaUrl}/api/tags`, { signal: timeout(5000) })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const models: string[] = ((await res.json())?.models || []).map((m: any) => String(m?.name || ''))
    const has = (name?: string) => !!name && models.some((m) => m === name || m.split(':')[0] === String(name).split(':')[0])
    const textModel = stored.ollamaModel || stored.llmModel
    const embModel = stored.embeddingModel || 'bge-m3'
    if (!textModel) services.ollama = { status: 'warn', detail: `Raggiungibile (${models.length} modelli) ma nessun modello testo configurato in Impostazioni.` }
    else if (!has(textModel)) services.ollama = { status: 'warn', detail: `Raggiungibile ma il modello "${textModel}" NON è sul server: «ollama pull ${textModel}».` }
    else services.ollama = { status: 'ok', detail: `${ollamaUrl} · modello "${textModel}" presente (${models.length} modelli totali).` }
    services.embeddings = has(embModel)
      ? { status: 'ok', detail: `Modello embeddings "${embModel}" presente (motore per-campo/Archivio utilizzabili).` }
      : { status: 'warn', detail: `Modello embeddings "${embModel}" ASSENTE: «ollama pull ${embModel}» (serve al motore per-campo e all'indice Archivio).` }
  } catch (err) {
    services.ollama = { status: 'fail', detail: `${ollamaUrl} NON raggiungibile (${(err as Error).message}). Verifica che Ollama sia avviato, OLLAMA_HOST=0.0.0.0 e firewall sulla porta 11434.` }
    services.embeddings = { status: 'fail', detail: 'Non verificabile: Ollama non raggiungibile.' }
  }

  // Qdrant (Archivio/ricerca semantica): opzionale — se non configurato lo si dice
  const qdrantUrl = (stored.qdrantUrl || '').trim()
  if (!qdrantUrl) {
    services.qdrant = { status: 'warn', detail: 'Non configurato (Impostazioni → Indice vettoriale): l\'Archivio/ricerca semantica resta disattivato. Con docker-compose il valore tipico è http://qdrant:6333.' }
  } else {
    try {
      const res = await fetch(`${qdrantUrl.replace(/\/$/, '')}/collections`, { signal: timeout(5000) })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const cols: string[] = ((await res.json())?.result?.collections || []).map((c: any) => String(c?.name || ''))
      const wanted = stored.qdrantCollection || 'documenti'
      services.qdrant = cols.includes(wanted)
        ? { status: 'ok', detail: `${qdrantUrl} · collezione "${wanted}" presente (${cols.length} collezioni).` }
        : { status: 'warn', detail: `${qdrantUrl} raggiungibile ma la collezione "${wanted}" non esiste ancora: viene creata alla prima indicizzazione (estrai un fascicolo con Qdrant attivo).` }
    } catch (err) {
      services.qdrant = { status: 'fail', detail: `${qdrantUrl} NON raggiungibile (${(err as Error).message}). Il container Qdrant è avviato? (docker compose up -d qdrant) URL giusto dal punto di vista del SERVER web, non del browser.` }
    }
  }

  // Email (magic-link + notifiche fine batch): presenza configurazione
  if (process.env.RESEND_API_KEY) {
    services.email = { status: 'ok', detail: `Resend configurato (RESEND_API_KEY presente)${process.env.SMTP_FROM ? ` · mittente ${process.env.SMTP_FROM}` : ' · manca SMTP_FROM (mittente)'}.` }
  } else if (process.env.SMTP_HOST) {
    services.email = { status: 'ok', detail: `SMTP configurato: ${process.env.SMTP_HOST}:${process.env.SMTP_PORT || '587'}${process.env.SMTP_FROM ? ` · mittente ${process.env.SMTP_FROM}` : ' · manca SMTP_FROM'}.` }
  } else {
    services.email = { status: 'fail', detail: 'Né RESEND_API_KEY né SMTP_HOST configurati: login via magic-link ed email di fine batch NON possono partire.' }
  }

  return NextResponse.json({ system, endpoint: ep, layers, ocr, services })
}
