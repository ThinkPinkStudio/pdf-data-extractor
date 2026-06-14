import { net } from 'electron'

// ─── Client HTTP resiliente per le chiamate in uscita del processo main ──────
//
// Strategia (in ordine):
//   1. fetch di Node (undici) — connessione DIRETTA. È il default storico che
//      funziona nella stragrande maggioranza dei casi.
//   2. retry con backoff sugli errori di rete TRANSITORI (es. connessione
//      resettata/rifiutata momentaneamente, cambio rete). Evita che un singolo
//      blip faccia perdere una pagina nell'estrazione rolling.
//   3. fallback a net.fetch (stack di rete di Chromium) SOLO se il fetch di Node
//      fallisce con un errore di rete/TLS: net.fetch rispetta il proxy di
//      sistema e le CA del sistema operativo (incluse quelle aziendali da
//      ispezione TLS). Utile dietro VPN/firewall aziendali.
//
// NB: net.fetch NON è il default perché in alcuni ambienti (es. proxy di
// sistema stale/legacy) introduce errori come ERR_NETWORK_CHANGED /
// ERR_CONNECTION_REFUSED su macchine dove la connessione diretta funziona.

// Errori transitori: vale la pena ritentare con lo stesso trasporto.
const TRANSIENT = [
  'err_network_changed', 'err_connection_refused', 'err_connection_reset',
  'err_connection_closed', 'err_connection_aborted', 'err_socket_not_connected',
  'econnreset', 'econnrefused', 'econnaborted', 'enetunreach', 'eai_again',
  'socket hang up', 'fetch failed', 'network changed'
]
// Errori "di rete/TLS": conviene provare l'altro trasporto (net.fetch).
const CONN_LIKE = [
  ...TRANSIENT,
  'err_cert', 'certificate', 'self-signed', 'self signed', 'issuer',
  'err_proxy', 'proxy', 'err_name_not_resolved', 'enotfound', 'err_tunnel', 'tls', 'ssl'
]
const RETRY_STATUS = new Set([408, 429, 500, 502, 503, 504])

const sleep = (ms) => new Promise(r => setTimeout(r, ms))
const matches = (err, list) => {
  const m = ((err && (err.message || String(err))) || '').toLowerCase()
  return list.some(t => m.includes(t))
}

async function fetchWithRetry(fetchFn, url, options, retries = 2, baseDelay = 600) {
  let lastErr
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetchFn(url, options)
      if (RETRY_STATUS.has(res.status) && attempt < retries) {
        await sleep(baseDelay * Math.pow(2, attempt))
        continue
      }
      return res
    } catch (err) {
      lastErr = err
      // NB: non ritentiamo su abort/timeout: il signal (AbortSignal.timeout) è
      // già scaduto e riusarlo fallirebbe all'istante. Ritentiamo solo i
      // transitori di connessione, dove il signal ha ancora tempo residuo.
      if (attempt < retries && matches(err, TRANSIENT)) {
        await sleep(baseDelay * Math.pow(2, attempt))
        continue
      }
      throw err
    }
  }
  throw lastErr
}

export async function resilientFetch(url, options = {}) {
  try {
    return await fetchWithRetry((u, o) => fetch(u, o), url, options)
  } catch (err) {
    // Fallback al network stack di Chromium (proxy di sistema + CA del SO).
    if (matches(err, CONN_LIKE) && net && typeof net.fetch === 'function') {
      try {
        return await net.fetch(url, options)
      } catch {
        // Il fallback non ha aiutato: rilancia l'errore originale (più utile
        // alla diagnosi: descrive il problema della connessione diretta).
        throw err
      }
    }
    throw err
  }
}

// Traduce un errore di rete (o uno stato HTTP) in una diagnosi leggibile,
// pensata per chi è dietro proxy/firewall/VPN aziendali.
export function describeNetworkError(err) {
  const raw = (err && (err.message || String(err))) || 'errore sconosciuto'
  const low = raw.toLowerCase()

  if (low.includes('abort') || low.includes('timed out') || low.includes('timeout') || low.includes('etimedout')) {
    return { stage: 'timeout', message: `Timeout: nessuna risposta entro il limite. Un proxy/firewall potrebbe bloccare l'uscita. (${raw})` }
  }
  if (low.includes('certificate') || low.includes('cert_') || low.includes('err_cert') ||
      low.includes('issuer') || low.includes('self-signed') || low.includes('self signed') ||
      low.includes('ssl') || low.includes('tls')) {
    return { stage: 'tls', message: `Errore certificato TLS: la rete fa probabilmente ispezione TLS con una CA aziendale non riconosciuta. (${raw})` }
  }
  if (low.includes('enotfound') || low.includes('name_not_resolved') || low.includes('getaddrinfo') || low.includes('dns')) {
    return { stage: 'dns', message: `DNS non risolto: dominio non raggiungibile da questa rete (DNS/proxy). (${raw})` }
  }
  if (low.includes('econnrefused') || low.includes('connection_refused') || low.includes('refused')) {
    return { stage: 'connect', message: `Connessione rifiutata: un proxy/firewall sta bloccando l'uscita verso il provider. (${raw})` }
  }
  if (low.includes('network_changed') || low.includes('network changed')) {
    return { stage: 'network', message: `La rete è cambiata durante la richiesta (Wi-Fi/VPN instabile). Riprova. (${raw})` }
  }
  if (low.includes('proxy')) {
    return { stage: 'proxy', message: `Errore proxy: configurazione proxy di sistema non valida o non raggiungibile. (${raw})` }
  }
  return { stage: 'network', message: raw }
}
