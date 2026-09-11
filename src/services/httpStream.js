/**
 * POST JSON in STREAMING via node:http/https, senza fetch/undici.
 *
 * Perché non fetch: il fetch di Node (undici) ha un `headersTimeout` di default
 * di 300 s. Ollama con `stream:true` manda gli header di risposta solo DOPO
 * aver letto tutto il prompt: se la lettura supera i 5 minuti (modello che
 * sborda su CPU, hardware lento, prompt da 8k token) fetch abortisce con
 * "fetch failed", il retry rimanda lo stesso prompt da zero e il watchdog del
 * chiamante taglia tutto poco dopo. Il batch è perso senza aver ricevuto un
 * solo token. Qui comanda SOLO l'AbortSignal del chiamante (watchdog per
 * token + tetto duro): "lento" continua, "morto" viene abortito.
 *
 * Ritorna { ok, status, stream, text() }: `stream` è l'IncomingMessage
 * (async-iterabile a chunk Buffer), `text()` legge tutto il corpo (per gli
 * errori). Abortire il signal distrugge la richiesta: Ollama vede la
 * connessione chiusa e CANCELLA la generazione (niente zombie).
 *
 * Retry: solo sugli errori di CONNESSIONE prima di qualunque risposta
 * (ECONNREFUSED/ECONNRESET/ecc.), 2 tentativi con backoff, mai dopo un abort.
 */
import http from 'node:http'
import https from 'node:https'

const CONN_ERRORS = ['ECONNREFUSED', 'ECONNRESET', 'ECONNABORTED', 'ENETUNREACH', 'EAI_AGAIN', 'EPIPE', 'ETIMEDOUT']
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function requestOnce(url, body, { signal, headers }) {
  return new Promise((resolve, reject) => {
    const u = new URL(url)
    const mod = u.protocol === 'https:' ? https : http
    const data = Buffer.from(JSON.stringify(body))
    const req = mod.request(u, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': data.length, ...(headers || {}) },
      signal,
    }, (res) => {
      resolve({
        ok: res.statusCode >= 200 && res.statusCode < 300,
        status: res.statusCode,
        stream: res,
        text: () => new Promise((ok, ko) => {
          let s = ''
          res.setEncoding('utf8')
          res.on('data', (c) => { s += c })
          res.on('end', () => ok(s))
          res.on('error', ko)
        }),
      })
    })
    req.on('error', reject)
    req.end(data)
  })
}

/**
 * @param {string} url
 * @param {object} body  oggetto JSON da inviare
 * @param {{ signal?: AbortSignal, headers?: object, retries?: number }} [opts]
 */
export async function postJsonStream(url, body, opts = {}) {
  const retries = opts.retries ?? 2
  let lastErr
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await requestOnce(url, body, opts)
    } catch (err) {
      lastErr = err
      const code = String(err?.code || err?.cause?.code || '')
      const aborted = err?.name === 'AbortError' || opts.signal?.aborted
      if (!aborted && attempt < retries && CONN_ERRORS.includes(code)) {
        await sleep(600 * Math.pow(2, attempt))
        continue
      }
      throw err
    }
  }
  throw lastErr
}
