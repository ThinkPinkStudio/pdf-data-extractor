/**
 * Indice vettoriale dei documenti (Qdrant locale + embeddings via Ollama).
 *
 * Ogni pagina OCR viene spezzata in chunk con overlap e salvata in Qdrant con
 * metadati ricchi (dossier, file, pagina, tipo documento, anno/data rilevati),
 * così i fascicoli restano interrogabili anche dopo l'estrazione (ricerca
 * semantica, e in prospettiva chat RAG e ri-estrazioni mirate).
 *
 * Modulo Node puro, condiviso Electron + web: solo REST (nessuna dipendenza
 * npm). Disattivato di default: si attiva impostando l'URL di Qdrant nelle
 * Impostazioni (es. http://127.0.0.1:6333).
 */
import { createHash } from 'crypto'
import { resilientFetch } from './netFetch.js'

const DEFAULT_COLLECTION = 'documenti'
const DEFAULT_EMBED_MODEL = 'bge-m3'   // multilingue, ottimo per l'italiano
const CHUNK_CHARS = 1200               // ~480 token: granularità da paragrafo/tabella
const CHUNK_OVERLAP = 150
const EMBED_BATCH = 32

export function isVectorIndexEnabled(settings) {
  return !!(settings?.qdrantUrl || '').trim()
}

function qdrantBase(settings) {
  return String(settings.qdrantUrl || '').trim().replace(/\/+$/, '')
}

// Header per le chiamate Qdrant: con QDRANT__SERVICE__API_KEY attivo sul server
// (es. deploy Coolify) OGNI richiesta senza 'api-key' riceve 401.
function qdrantHeaders(settings, extra = {}) {
  const key = String(settings?.qdrantApiKey || '').trim()
  return { ...(key ? { 'api-key': key } : {}), ...extra }
}

function collectionName(settings) {
  return (settings.qdrantCollection || '').trim() || DEFAULT_COLLECTION
}

// ID deterministico (UUID v5-like da SHA-1): ri-indicizzare lo stesso fascicolo
// aggiorna i punti esistenti invece di duplicarli.
//
// SCOPE: la prima componente è l'identità del FASCICOLO — lo scopeId (job_id, che
// è univoco per costruzione) quando il chiamante lo fornisce, il nome dossier solo
// come fallback (desktop). Senza scope univoco, due fascicoli con cartella e nomi
// file uguali ("RCT 2024/quietanza 2024.pdf" di clienti diversi) collidono e si
// SOVRASCRIVONO a vicenda in silenzio. La seconda componente è l'identità del
// FILE: l'hash del contenuto quando c'è (stesso file = stesso punto anche se
// rinominato), il nome come fallback.
function pointId(scope, fileKey, page, chunk) {
  const h = createHash('sha1').update(`${scope}|${fileKey}|${page}|${chunk}`).digest('hex')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`
}

// Tipo documento euristico dal nome file: metadato di filtro, non verità assoluta.
export function classifyDocType(fileName) {
  const n = String(fileName || '').toLowerCase()
  if (/quietanz/.test(n)) return 'quietanza'
  if (/regolazion/.test(n)) return 'regolazione'
  if (/appendic/.test(n)) return 'appendice'
  if (/polizza|contratto/.test(n)) return 'polizza'
  if (/condizioni/.test(n)) return 'condizioni'
  return 'altro'
}

// Anno del documento: prima dal nome file, poi dalla prima data GG/MM/AAAA nel testo.
export function detectDocYear(fileName, text) {
  const fromName = String(fileName || '').match(/\b(19|20)\d{2}\b/)
  if (fromName) return parseInt(fromName[0], 10)
  const fromText = String(text || '').match(/\b\d{1,2}[/.-]\d{1,2}[/.-]((19|20)\d{2})\b/)
  if (fromText) return parseInt(fromText[1], 10)
  return null
}

// Chunking con overlap, spezzando preferibilmente su fine riga/frase.
export function chunkText(text, maxChars = CHUNK_CHARS, overlap = CHUNK_OVERLAP) {
  const t = String(text || '').trim()
  if (!t) return []
  if (t.length <= maxChars) return [t]
  const chunks = []
  let start = 0
  while (start < t.length) {
    let end = Math.min(start + maxChars, t.length)
    if (end < t.length) {
      // Cerca un confine "naturale" (riga o frase) nell'ultimo quarto del chunk
      const window = t.slice(start + Math.floor(maxChars * 0.75), end)
      const cut = Math.max(window.lastIndexOf('\n'), window.lastIndexOf('. '))
      if (cut > 0) end = start + Math.floor(maxChars * 0.75) + cut + 1
    }
    chunks.push(t.slice(start, end).trim())
    if (end >= t.length) break
    start = Math.max(end - overlap, start + 1)
  }
  return chunks.filter(Boolean)
}

// Chunking "label-aware": NUNCA spezza in medio una coppia "label: valor" ni
// una riga que contiene el símbolo "€". Un chunk que terminaria partiendo la
// coppia se extiende hasta la próxima riga si esta cae dentro del overlap.
// Previene que la retrieval pierda el par label→valor partido (causa del 0/28).
export function chunkTextLabelAware(text, maxChars = CHUNK_CHARS, overlap = CHUNK_OVERLAP) {
  const t = String(text || '').trim()
  if (!t) return []
  if (t.length <= maxChars) return [t]
  const lines = t.split('\n')
  const keep = new Set()
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes('€') || /:\s+[^\n]*\d[^\n]*$/i.test(lines[i])) keep.add(i)
  }
  const chunks = []
  let si = 0
  while (si < lines.length) {
    let acc = lines[si] || ''
    let ei = si + 1
    let guard = 0
    while (ei < lines.length && guard++ < 1000) {
      const cand = acc + '\n' + lines[ei]
      const splitPair = keep.has(ei - 1) && !keep.has(ei)
      if (cand.length > maxChars && splitPair) {
        const next = lines[ei + 1]
        if (next != null && (lines[ei].length + next.length + 2) <= overlap) {
          acc = cand + '\n' + next
          ei += 2
          continue
        }
        break
      }
      acc = cand
      ei++
      if (cand.length >= maxChars) break
    }
    chunks.push(acc)
    let back = 1
    while (back < ei - si && back < 500 && keep.has(ei - 1 - back)) back++
    const nsi = Math.max(ei - back, si + 1)
    if (nsi <= si) break
    si = nsi
  }
  return chunks.filter(Boolean)
}

// Embeddings via Ollama (/api/embed accetta input multipli in una chiamata).
// Esportata: riusata dal motore "per-campo" di polizzaService (indice in memoria).
export async function embedTexts(settings, texts) {
  const url = (settings.ollamaUrl || 'http://127.0.0.1:11434').replace(/\/+$/, '')
  const model = (settings.embeddingModel || '').trim() || DEFAULT_EMBED_MODEL
  const res = await resilientFetch(`${url}/api/embed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, input: texts }),
    // Primo uso: Ollama deve caricare il modello di embedding → tempi lunghi
    signal: AbortSignal.timeout(180000)
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Ollama embeddings error ${res.status}${body ? `: ${body.slice(0, 200)}` : ''}`)
  }
  const data = await res.json()
  const embeddings = data.embeddings
  if (!Array.isArray(embeddings) || embeddings.length !== texts.length) {
    throw new Error(`Ollama embeddings: risposta inattesa (attesi ${texts.length} vettori)`)
  }
  return embeddings
}

async function ensureCollection(settings, dim) {
  const base = qdrantBase(settings)
  const coll = collectionName(settings)
  const probe = await resilientFetch(`${base}/collections/${coll}`, { headers: qdrantHeaders(settings), signal: AbortSignal.timeout(10000) })
  if (probe.ok) return coll
  const res = await resilientFetch(`${base}/collections/${coll}`, {
    method: 'PUT',
    headers: qdrantHeaders(settings, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({ vectors: { size: dim, distance: 'Cosine' } }),
    signal: AbortSignal.timeout(15000)
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Qdrant: creazione collezione fallita ${res.status}${body ? `: ${body.slice(0, 200)}` : ''}`)
  }
  return coll
}

/**
 * Indicizza un dossier: files = [{ name, pages: [testoPagina, ...], hash? }].
 * scopeId (opzionale ma FORTEMENTE consigliato, es. il job_id): identità univoca
 * del fascicolo — senza, il fallback è il nome dossier, che può collidere tra
 * caricamenti diversi. file.hash (SHA-256 del contenuto) rende l'identità del
 * file indipendente da nome e cartella.
 * Ritorna { chunks, collection }. Lancia in caso di errore: il chiamante decide
 * (nei flussi di estrazione va trattato come NON fatale).
 */
export async function indexDossierPages({ dossierName, files, extraPayload = {}, scopeId = null }, settings, log = null) {
  if (!isVectorIndexEnabled(settings)) throw new Error('Indice vettoriale non configurato (URL Qdrant vuoto).')
  const dossier = String(dossierName || 'dossier').trim() || 'dossier'
  const scope = String(scopeId || '').trim() || dossier
  const indexedAt = new Date().toISOString()

  // Costruzione chunk + payload
  const entries = []
  for (const f of files || []) {
    const fileName = f?.name || 'documento.pdf'
    const fileHash = (f?.hash || '').trim() || null
    const docType = classifyDocType(fileName)
    const fullDocText = (f?.pages || []).join('\n')
    const docYear = detectDocYear(fileName, fullDocText)
    ;(f?.pages || []).forEach((pageText, pIdx) => {
      chunkText(pageText).forEach((chunk, cIdx) => {
        entries.push({
          id: pointId(scope, fileHash || fileName, pIdx + 1, cIdx),
          payload: {
            dossier,
            file: fileName,
            ...(fileHash ? { file_hash: fileHash } : {}),
            page: pIdx + 1,
            chunk: cIdx,
            doc_type: docType,
            doc_year: docYear,
            indexed_at: indexedAt,
            text: chunk,
            ...extraPayload
          },
          text: chunk
        })
      })
    })
  }
  if (!entries.length) return { chunks: 0, collection: collectionName(settings) }

  // Embeddings a lotti + upsert
  let collection = null
  for (let i = 0; i < entries.length; i += EMBED_BATCH) {
    const batch = entries.slice(i, i + EMBED_BATCH)
    const vectors = await embedTexts(settings, batch.map(e => e.text))
    if (!collection) collection = await ensureCollection(settings, vectors[0].length)
    const res = await resilientFetch(`${qdrantBase(settings)}/collections/${collection}/points?wait=true`, {
      method: 'PUT',
      headers: qdrantHeaders(settings, { 'Content-Type': 'application/json' }),
      body: JSON.stringify({ points: batch.map((e, j) => ({ id: e.id, vector: vectors[j], payload: e.payload })) }),
      signal: AbortSignal.timeout(30000)
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new Error(`Qdrant upsert error ${res.status}${body ? `: ${body.slice(0, 200)}` : ''}`)
    }
    log?.(`Indice vettoriale: ${Math.min(i + EMBED_BATCH, entries.length)}/${entries.length} chunk`)
  }
  return { chunks: entries.length, collection }
}

/**
 * Ricerca semantica. Filtri opzionali: jobId (ERMETICO: solo i punti di quel
 * fascicolo — da preferire quando si cerca "nella polizza X"), polizzaNumero
 * (stessa polizza attraverso caricamenti diversi), dossier (nome leggibile,
 * può collidere), docType, year.
 * Ritorna [{ score, dossier, file, page, doc_type, doc_year, job_id, polizza_numero, text }].
 */
export async function searchVector({ query, jobId = null, polizzaNumero = null, dossier = null, docType = null, year = null, file = null, limit = 10 }, settings) {
  if (!isVectorIndexEnabled(settings)) throw new Error('Indice vettoriale non configurato (URL Qdrant vuoto).')
  const q = String(query || '').trim()
  if (!q) return []
  const [vector] = await embedTexts(settings, [q])

  const must = []
  if (jobId) must.push({ key: 'job_id', match: { value: jobId } })
  if (polizzaNumero) must.push({ key: 'polizza_numero', match: { value: String(polizzaNumero) } })
  if (dossier) must.push({ key: 'dossier', match: { value: dossier } })
  if (docType) must.push({ key: 'doc_type', match: { value: docType } })
  if (year) must.push({ key: 'doc_year', match: { value: Number(year) } })
  if (file) must.push({ key: 'file', match: { value: file } })

  const res = await resilientFetch(`${qdrantBase(settings)}/collections/${collectionName(settings)}/points/search`, {
    method: 'POST',
    headers: qdrantHeaders(settings, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({
      vector,
      limit: Math.max(1, Math.min(50, Number(limit) || 10)),
      with_payload: true,
      ...(must.length ? { filter: { must } } : {})
    }),
    signal: AbortSignal.timeout(20000)
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Qdrant search error ${res.status}${body ? `: ${body.slice(0, 200)}` : ''}`)
  }
  const data = await res.json()
  return (data.result || []).map(hit => ({
    score: hit.score,
    dossier: hit.payload?.dossier,
    file: hit.payload?.file,
    page: hit.payload?.page,
    doc_type: hit.payload?.doc_type,
    doc_year: hit.payload?.doc_year,
    job_id: hit.payload?.job_id,
    polizza_numero: hit.payload?.polizza_numero,
    text: hit.payload?.text
  }))
}

/**
 * Statistiche della collezione (pannello Manutenzione dati).
 * Ritorna { exists, points } — points = numero di punti indicizzati.
 */
export async function collectionStats(settings) {
  if (!isVectorIndexEnabled(settings)) return { exists: false, points: 0 }
  const res = await resilientFetch(`${qdrantBase(settings)}/collections/${collectionName(settings)}`, {
    headers: qdrantHeaders(settings), signal: AbortSignal.timeout(10000)
  })
  if (res.status === 404) return { exists: false, points: 0 }
  if (!res.ok) throw new Error(`Qdrant HTTP ${res.status}`)
  const data = await res.json()
  return { exists: true, points: data?.result?.points_count ?? 0, collection: collectionName(settings) }
}

/**
 * Cancella i punti che matchano i filtri (jobId / dossier / polizzaNumero / file).
 * Almeno UN filtro è obbligatorio: mai una delete senza confini per errore.
 * Ritorna { ok: true } (Qdrant non riporta il conteggio dei punti rimossi).
 */
export async function deletePointsByFilter({ jobId = null, dossier = null, polizzaNumero = null, file = null }, settings) {
  if (!isVectorIndexEnabled(settings)) throw new Error('Indice vettoriale non configurato (URL Qdrant vuoto).')
  const must = []
  if (jobId) must.push({ key: 'job_id', match: { value: jobId } })
  if (dossier) must.push({ key: 'dossier', match: { value: dossier } })
  if (polizzaNumero) must.push({ key: 'polizza_numero', match: { value: String(polizzaNumero) } })
  if (file) must.push({ key: 'file', match: { value: file } })
  if (!must.length) throw new Error('Cancellazione senza filtri rifiutata: specifica fascicolo, polizza o documento.')
  const res = await resilientFetch(`${qdrantBase(settings)}/collections/${collectionName(settings)}/points/delete?wait=true`, {
    method: 'POST',
    headers: qdrantHeaders(settings, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({ filter: { must } }),
    signal: AbortSignal.timeout(30000)
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Qdrant delete error ${res.status}${body ? `: ${body.slice(0, 200)}` : ''}`)
  }
  return { ok: true }
}

/** Svuota l'INTERA collezione (drop): alla prossima indicizzazione viene ricreata. */
export async function dropCollection(settings) {
  if (!isVectorIndexEnabled(settings)) throw new Error('Indice vettoriale non configurato (URL Qdrant vuoto).')
  const res = await resilientFetch(`${qdrantBase(settings)}/collections/${collectionName(settings)}`, {
    method: 'DELETE', headers: qdrantHeaders(settings), signal: AbortSignal.timeout(30000)
  })
  if (!res.ok && res.status !== 404) {
    const body = await res.text().catch(() => '')
    throw new Error(`Qdrant drop error ${res.status}${body ? `: ${body.slice(0, 200)}` : ''}`)
  }
  return { ok: true }
}

/** Verifica raggiungibilità di Qdrant (per diagnostica/Impostazioni). */
export async function probeQdrant(settings) {
  if (!isVectorIndexEnabled(settings)) return { available: false, reason: 'URL Qdrant non configurato' }
  try {
    const res = await resilientFetch(`${qdrantBase(settings)}/collections`, { headers: qdrantHeaders(settings), signal: AbortSignal.timeout(8000) })
    if (res.status === 401 || res.status === 403) {
      return { available: false, reason: `HTTP ${res.status}: il server Qdrant richiede una API key${String(settings?.qdrantApiKey || '').trim() ? ' (quella configurata non è valida)' : ' — impostala nelle Impostazioni (Indice vettoriale)'}.` }
    }
    if (!res.ok) return { available: false, reason: `HTTP ${res.status}` }
    return { available: true }
  } catch (err) {
    return { available: false, reason: err.message }
  }
}
