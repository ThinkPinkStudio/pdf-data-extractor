import dns from 'node:dns'
import net from 'node:net'
import tls from 'node:tls'
import { performance } from 'node:perf_hooks'
import { resilientFetch } from './netFetch.js'

// ─── Diagnostica di rete FORENSE, a strati ───────────────────────────────────
//
// La diagnostica "rapida" (testProviderConnection) fa UNA sola fetch che mescola
// DNS + TCP + TLS + HTTP: se fallisce non sa dire A QUALE livello, e soprattutto
// non cattura la catena di certificati realmente presentata dalla rete.
//
// Qui spacchiamo la connessione verso il provider in strati indipendenti, ognuno
// cronometrato e con timeout proprio. Il pezzo chiave è probeTls(): apriamo
// l'handshake con rejectUnauthorized:false così COMPLETA anche con una catena
// non fidata, e leggiamo l'emittente reale del certificato. Se la rete del
// cliente fa ispezione TLS, l'issuer sarà una CA di firewall/AV (Fortinet,
// Zscaler, …) invece della CA reale: è la PROVA che è la rete a manomettere la
// connessione, non l'app.

const TIMEOUTS = { dns: 4000, tcp: 6000, tls: 8000, http: 8000, control: 5000 }

// Marcatori (substring, minuscolo) di prodotti di sicurezza/firewall/AV che
// fanno ispezione TLS. Confrontati con issuer O e CN della catena.
const INTERCEPTION_VENDORS = [
  'fortinet', 'fortigate', 'zscaler', 'sophos', 'palo alto', 'paloalto', 'globalprotect',
  'check point', 'checkpoint', 'cisco umbrella', 'opendns', 'umbrella', 'kaspersky',
  'eset', 'bitdefender', 'avast', 'avg', 'netskope', 'forcepoint', 'websense',
  'blue coat', 'bluecoat', 'symantec web', 'broadcom', 'mcafee', 'trustwave',
  'sangfor', 'sonicwall', 'barracuda', 'watchguard', 'trend micro', 'sslproxy',
  'kerio', 'untangle', 'smoothwall', 'squid', 'mitmproxy', 'charles', 'fiddler',
  'cloudflare warp', 'proxy', 'firewall', 'inspection', 'deep packet'
]

// CA pubbliche note: se la root NON è fra queste (e magari è self-signed),
// è sospetta. Lista usata solo come segnale secondario; l'issuer reale viene
// SEMPRE riportato verbatim così un umano può giudicare.
const EXPECTED_ROOT_ISSUER_O = [
  'google trust services', 'digicert', "let's encrypt", 'internet security research group',
  'isrg', 'baltimore', 'cloudflare', 'amazon', 'ssl corp', 'sectigo', 'globalsign',
  'entrust', 'usertrust', 'comodo'
]

const ms = (t0) => Math.round(performance.now() - t0)
const timeoutReject = (delay, code) =>
  new Promise((_, rej) => setTimeout(() => { const e = new Error(`timeout (${delay}ms)`); e.code = code; rej(e) }, delay))

// Restituisce host/porta/url del provider configurato. Ollama è locale: la
// diagnostica di rete non è significativa, il chiamante salta.
export function endpointForProvider(settings) {
  const provider = settings.llmProvider || 'ollama'
  if (provider === 'openai') return { host: 'api.openai.com', port: 443, label: 'OpenAI', url: 'https://api.openai.com/v1/models' }
  if (provider === 'anthropic') return { host: 'api.anthropic.com', port: 443, label: 'Anthropic', url: 'https://api.anthropic.com/v1/messages' }
  return { host: null, port: null, label: 'Ollama', url: settings.ollamaUrl || 'http://127.0.0.1:11434' }
}

// ─── Strato 1: DNS ───────────────────────────────────────────────────────────
export async function probeDns(host) {
  const t0 = performance.now()
  const servers = (() => { try { return dns.getServers() } catch { return [] } })()
  try {
    const res = await Promise.race([
      dns.promises.lookup(host, { all: true, verbatim: true }),
      timeoutReject(TIMEOUTS.dns, 'ETIMEDOUT')
    ])
    const ips = res.map(r => r.address)
    return { status: 'ok', ms: ms(t0), host, ips, servers, error: null, code: null }
  } catch (err) {
    return { status: 'fail', ms: ms(t0), host, ips: [], servers, error: err.message, code: err.code || null }
  }
}

// ─── Strato 2: TCP connect ───────────────────────────────────────────────────
export function probeTcp(host, port, ip) {
  return new Promise((resolve) => {
    const t0 = performance.now()
    const target = ip || host
    const sock = net.connect({ host: target, port })
    let done = false
    const finish = (r) => { if (done) return; done = true; try { sock.destroy() } catch { /* noop */ } resolve(r) }
    const timer = setTimeout(() => finish({ status: 'fail', ms: ms(t0), error: 'connect timeout', code: 'ETIMEDOUT' }), TIMEOUTS.tcp)
    sock.once('connect', () => { clearTimeout(timer); finish({ status: 'ok', ms: ms(t0), error: null, code: null, peer: `${target}:${port}` }) })
    sock.once('error', (err) => { clearTimeout(timer); finish({ status: 'fail', ms: ms(t0), error: err.message, code: err.code || null }) })
  })
}

// ─── Strato 3: TLS handshake + catena certificati (la prova del reato) ────────
export function probeTls(host, port) {
  return new Promise((resolve) => {
    const t0 = performance.now()
    // rejectUnauthorized:false → l'handshake completa ANCHE con catena non
    // fidata: è esattamente il caso che vogliamo ispezionare. Leggiamo noi
    // authorized/authorizationError per riportare lo stato di fiducia.
    const sock = tls.connect({ host, port, servername: host, rejectUnauthorized: false, ALPNProtocols: ['h2', 'http/1.1'] })
    let done = false
    const finish = (r) => { if (done) return; done = true; try { sock.destroy() } catch { /* noop */ } resolve(r) }
    const timer = setTimeout(() => finish({ status: 'fail', ms: ms(t0), error: 'tls timeout', code: 'ETIMEDOUT', chain: [] }), TIMEOUTS.tls)

    sock.once('secureConnect', () => {
      clearTimeout(timer)
      const cert = sock.getPeerCertificate(true) // true = catena completa
      const chain = flattenChain(cert)
      const verdict = analyzeChain(chain, sock.authorized, sock.authorizationError)
      const cipher = sock.getCipher() || {}
      finish({
        status: (verdict.intercepted || verdict.suspicious) ? 'warn' : 'ok',
        ms: ms(t0),
        protocol: sock.getProtocol(),
        cipher: cipher.name || null,
        alpn: sock.alpnProtocol || null,
        authorized: sock.authorized,
        authorizationError: sock.authorizationError ? String(sock.authorizationError) : null,
        chain,
        ...verdict,
        error: null,
        code: null
      })
    })
    sock.once('error', (err) => { clearTimeout(timer); finish({ status: 'fail', ms: ms(t0), error: err.message, code: err.code || null, chain: [] }) })
  })
}

// Linearizza la catena seguendo i link issuerCertificate fino alla root
// self-signed (il link punta a se stesso).
function flattenChain(cert) {
  const out = []
  const seen = new Set()
  let c = cert
  while (c && c.fingerprint256 && !seen.has(c.fingerprint256)) {
    seen.add(c.fingerprint256)
    out.push({
      subjectCN: c.subject?.CN || null,
      subjectO: c.subject?.O || null,
      issuerCN: c.issuer?.CN || null,
      issuerO: c.issuer?.O || null,
      fingerprint256: c.fingerprint256,
      validFrom: c.valid_from || null,
      validTo: c.valid_to || null,
      selfSigned: !!(c.subject?.CN && c.subject.CN === c.issuer?.CN && c.subject?.O === c.issuer?.O)
    })
    if (c.issuerCertificate === c) break // root self-signed raggiunta
    c = c.issuerCertificate
  }
  return out
}

// Euristica di intercettazione TLS. Riporta SEMPRE l'issuer reale.
//
// NB: ogni root CA è self-signed (è la definizione di root): "self-signed" da
// solo NON è prova di intercettazione. La PROVA forte è:
//   1. l'issuer corrisponde a un vendor di sicurezza/firewall noto, oppure
//   2. authorized === false → lo store di certificati bundled di Node RIFIUTA
//      la catena: tipico di una CA iniettata da un middlebox e non pubblica.
// Il caso "catena fidata ma root non in elenco pubblico noto" è solo un
// SOSPETTO (potrebbe essere una CA pubblica non in lista, oppure una CA
// aziendale installata nello store): lo segnaliamo senza asserire la colpa.
function analyzeChain(chain, authorized, authError) {
  const root = chain[chain.length - 1] || {}
  const leaf = chain[0] || {}
  const haystack = [root.issuerO, root.issuerCN, root.subjectO, root.subjectCN, leaf.issuerO, leaf.issuerCN]
    .filter(Boolean).join(' | ').toLowerCase()

  const vendorHit = INTERCEPTION_VENDORS.find(v => haystack.includes(v))
  const rootName = (root.issuerO || root.subjectO || root.issuerCN || '').toLowerCase()
  const rootIsKnownPublic = EXPECTED_ROOT_ISSUER_O.some(o => rootName.includes(o))

  let intercepted = false
  let interceptionReason = null
  let suspicious = false
  let suspicionReason = null

  if (vendorHit) {
    intercepted = true
    interceptionReason = `Issuer riconducibile a un prodotto di sicurezza/firewall: "${vendorHit}"`
  } else if (authorized === false) {
    intercepted = true
    interceptionReason = `La catena non è attendibile per lo store di certificati (${authError || 'untrusted'}): tipico dell'ispezione TLS con una CA non pubblica.`
  } else if (!rootIsKnownPublic && chain.length > 0) {
    suspicious = true
    suspicionReason = `Root CA fidata dal sistema ma non in elenco pubblico noto: ${root.issuerO || root.issuerCN || '(sconosciuta)'}. Se è una CA aziendale installata, la rete sta ispezionando il traffico TLS.`
  }

  return {
    intercepted,
    interceptionReason,
    suspicious,
    suspicionReason,
    rootIssuer: root.issuerO || root.issuerCN || '(sconosciuto)',
    leafSubject: leaf.subjectCN || '(sconosciuto)',
    rootIsKnownPublic
  }
}

// ─── Strato 4: HTTP probe (riusa resilientFetch) ─────────────────────────────
export async function probeHttp(url, headers = {}) {
  const t0 = performance.now()
  const isAnthropic = url.includes('anthropic')
  try {
    const res = await resilientFetch(url, {
      method: isAnthropic ? 'POST' : 'GET',
      headers,
      body: isAnthropic ? JSON.stringify({ model: 'probe', max_tokens: 1, messages: [{ role: 'user', content: 'ping' }] }) : undefined,
      signal: AbortSignal.timeout(TIMEOUTS.http)
    })
    // Qualunque status HTTP (anche 401/403) prova che rete+proxy+TLS funzionano.
    return { status: 'ok', ms: ms(t0), httpStatus: res.status, error: null, code: null }
  } catch (err) {
    return { status: 'fail', ms: ms(t0), httpStatus: null, error: err.message, code: err.code || null }
  }
}

// ─── Strato 5: proxy di sistema ──────────────────────────────────────────────
export async function probeProxy(session, url) {
  const env = {
    HTTP_PROXY: process.env.HTTP_PROXY || process.env.http_proxy || null,
    HTTPS_PROXY: process.env.HTTPS_PROXY || process.env.https_proxy || null,
    NO_PROXY: process.env.NO_PROXY || process.env.no_proxy || null
  }
  let resolved = null
  try {
    if (session && typeof session.resolveProxy === 'function') resolved = await session.resolveProxy(url)
  } catch (err) {
    resolved = `error: ${err.message}`
  }
  const usingProxy = (resolved && !/^DIRECT/i.test(resolved)) || !!(env.HTTP_PROXY || env.HTTPS_PROXY)
  return { status: 'ok', resolved, env, usingProxy }
}

// ─── Strato 6: endpoint di controllo (confronto a tre vie) ───────────────────
const CONTROLS = [
  { id: 'generate_204', label: 'Connettività neutra (HTTP 204)', url: 'https://www.gstatic.com/generate_204', expect: 204 },
  { id: 'cloudflare', label: 'Endpoint cloud alternativo (Cloudflare)', url: 'https://cloudflare.com/cdn-cgi/trace', expect: 200 },
  { id: 'second_cloud', label: 'Secondo cloud API (OpenAI)', url: 'https://api.openai.com/v1/models', expect: [200, 401, 403] }
]
export async function probeControls() {
  return Promise.all(CONTROLS.map(async c => {
    const t0 = performance.now()
    try {
      const res = await resilientFetch(c.url, { signal: AbortSignal.timeout(TIMEOUTS.control) })
      const ok = Array.isArray(c.expect) ? c.expect.includes(res.status) : res.status === c.expect
      // generate_204 che torna 200 (anziché 204) = probabile captive portal.
      return { id: c.id, label: c.label, status: ok ? 'ok' : 'warn', httpStatus: res.status, ms: ms(t0), error: null }
    } catch (err) {
      return { id: c.id, label: c.label, status: 'fail', httpStatus: null, ms: ms(t0), error: err.message, code: err.code || null }
    }
  }))
}

// ─── Orchestratore ───────────────────────────────────────────────────────────
export async function runDeepDiagnostics({ settings, session }) {
  const startedAt = new Date().toISOString()
  const ep = endpointForProvider(settings)
  const result = {
    type: 'deep-net', startedAt, finishedAt: null,
    provider: ep.label, host: ep.host,
    layers: {}, controls: [], proxy: null, verdict: null, verdictText: ''
  }

  if (!ep.host) {
    result.verdict = 'n/a'
    result.verdictText = 'Provider locale (Ollama): la diagnostica di rete non è applicabile.'
    result.finishedAt = new Date().toISOString()
    return result
  }

  const dnsR = await probeDns(ep.host)
  result.layers.dns = dnsR
  const ip = dnsR.ips?.[0] || null

  result.layers.tcp = dnsR.status === 'ok'
    ? await probeTcp(ep.host, ep.port, ip)
    : { status: 'skip', reason: 'DNS fallito' }

  result.layers.tls = result.layers.tcp.status === 'ok'
    ? await probeTls(ep.host, ep.port)
    : { status: 'skip', reason: 'TCP fallito' }

  const headers = ep.label === 'Anthropic'
    ? { 'Content-Type': 'application/json', 'x-api-key': settings.anthropicApiKey || '', 'anthropic-version': '2023-06-01' }
    : { Authorization: `Bearer ${settings.openaiApiKey || ''}` }
  const tlsOk = result.layers.tls.status === 'ok' || result.layers.tls.status === 'warn'
  result.layers.http = tlsOk ? await probeHttp(ep.url, headers) : { status: 'skip', reason: 'TLS fallito' }

  result.proxy = await probeProxy(session, ep.url)
  result.controls = await probeControls()

  Object.assign(result, deriveVerdict(result))
  result.finishedAt = new Date().toISOString()
  return result
}

// Deriva un verdetto singolo (machine + testo italiano) in ordine di priorità.
function deriveVerdict(result) {
  const { dns: dnsR, tcp, tls: tlsR, http } = result.layers
  const controlsAnyOk = result.controls.some(c => c.status === 'ok')
  const captive = result.controls.some(c => c.id === 'generate_204' && c.status === 'warn' && c.httpStatus === 200)

  if (tlsR?.intercepted) {
    return {
      verdict: 'tls-interception',
      verdictText: `PROVA: la rete intercetta il traffico TLS. Il certificato di ${result.host} è emesso da «${tlsR.rootIssuer}» (${tlsR.interceptionReason}), NON dalla CA reale del provider. È la rete del cliente a modificare la connessione: va autorizzato ${result.host} nel firewall oppure disattivata l'ispezione TLS / installata la CA aziendale. L'app funziona correttamente.`
    }
  }
  if (dnsR?.status === 'fail') {
    return controlsAnyOk
      ? { verdict: 'dns-blocked', verdictText: `Il DNS non risolve ${result.host} (${dnsR.code || 'errore'}) ma altri siti funzionano: è la rete/il DNS del cliente a bloccare il dominio. Server DNS in uso: ${(dnsR.servers || []).join(', ') || 'n/d'}.` }
      : { verdict: 'no-internet', verdictText: 'Nessuna connessione a internet da questa rete: falliscono sia il provider sia gli endpoint di controllo neutri.' }
  }
  if (tcp?.status === 'fail') {
    return controlsAnyOk
      ? { verdict: 'egress-blocked', verdictText: `Connessione TCP a ${result.host}:443 bloccata (${tcp.code || 'errore'}) mentre internet neutro funziona: un firewall/proxy del cliente blocca specificamente l'uscita verso il provider.` }
      : { verdict: 'no-internet', verdictText: 'Nessuna connessione di rete utilizzabile: fallisce anche la connessione agli endpoint di controllo.' }
  }
  if (tlsR?.status === 'fail') {
    return { verdict: 'tls-blocked', verdictText: `Handshake TLS verso ${result.host} fallito (${tlsR.code || 'errore'}): probabile blocco/manomissione del traffico cifrato da parte della rete.` }
  }
  if (http?.httpStatus === 401 || http?.httpStatus === 403) {
    return { verdict: 'auth', verdictText: `Rete, proxy e TLS funzionano (HTTP ${http.httpStatus}): il problema è la API key, rifiutata dal provider. Non è un problema di rete né dell'app.` }
  }
  if (typeof http?.httpStatus === 'number') {
    return { verdict: 'all-ok', verdictText: `Tutti gli strati di rete funzionano: DNS, TCP, TLS e HTTP verso ${result.host} sono OK (HTTP ${http.httpStatus}).` }
  }
  if (captive) {
    return { verdict: 'captive-portal', verdictText: 'Rilevato probabile captive portal: la richiesta a un endpoint che dovrebbe rispondere 204 ha invece restituito una pagina (HTTP 200). Completa il login alla rete Wi-Fi e riprova.' }
  }
  if (result.proxy?.usingProxy && http?.status === 'fail') {
    return { verdict: 'proxy', verdictText: `È configurato un proxy (${result.proxy.resolved || 'env'}) e la richiesta HTTP fallisce: il proxy del cliente blocca o non instrada il traffico verso ${result.host}.` }
  }
  return { verdict: 'unknown', verdictText: `Esito non determinato. Allega il report completo al supporto. Host: ${result.host}.` }
}

// ─── Report umano (testo) per l'export ───────────────────────────────────────
export function buildHumanReport({ result, quickReport, system }) {
  const L = []
  const sep = '────────────────────────────────────────────────────────'
  L.push('PDF Data Extractor — Report diagnostica di rete (forense)')
  L.push(new Date().toLocaleString())
  if (system) L.push(`Sistema: ${system.platform} ${system.arch} · App v${system.appVersion} · Electron ${system.electron} · Chrome ${system.chrome} · Node ${system.node}`)
  L.push(sep)

  if (result) {
    L.push(`VERDETTO: ${result.verdict}`)
    L.push(result.verdictText || '')
    L.push(sep)
    L.push(`Provider: ${result.provider} · Host: ${result.host}`)
    L.push(`Avvio: ${result.startedAt} · Fine: ${result.finishedAt}`)
    L.push('')

    const d = result.layers?.dns
    if (d) L.push(`[DNS]  ${d.status.toUpperCase()} · ${d.ms ?? '?'}ms · IP: ${(d.ips || []).join(', ') || '—'} · server DNS: ${(d.servers || []).join(', ') || '—'}${d.error ? ` · errore: ${d.code || ''} ${d.error}` : ''}`)

    const t = result.layers?.tcp
    if (t) L.push(`[TCP]  ${String(t.status).toUpperCase()}${t.ms != null ? ` · ${t.ms}ms` : ''}${t.peer ? ` · ${t.peer}` : ''}${t.error ? ` · errore: ${t.code || ''} ${t.error}` : ''}${t.reason ? ` · ${t.reason}` : ''}`)

    const tl = result.layers?.tls
    if (tl) {
      L.push(`[TLS]  ${String(tl.status).toUpperCase()}${tl.ms != null ? ` · ${tl.ms}ms` : ''}${tl.protocol ? ` · ${tl.protocol}` : ''}${tl.cipher ? ` · ${tl.cipher}` : ''}${tl.reason ? ` · ${tl.reason}` : ''}`)
      if (tl.authorizationError) L.push(`       authorized=${tl.authorized} · authorizationError=${tl.authorizationError}`)
      if (tl.rootIssuer) L.push(`       Emittente root: ${tl.rootIssuer}${tl.intercepted ? '  ⚠ INTERCETTAZIONE TLS' : tl.suspicious ? '  ⚠ SOSPETTO' : ''}`)
      if (tl.interceptionReason) L.push(`       ${tl.interceptionReason}`)
      if (tl.suspicionReason) L.push(`       ${tl.suspicionReason}`)
      ;(tl.chain || []).forEach((c, i) => {
        L.push(`       cert[${i}] subject CN=${c.subjectCN || '—'} O=${c.subjectO || '—'}`)
        L.push(`               issuer  CN=${c.issuerCN || '—'} O=${c.issuerO || '—'}`)
        L.push(`               fp256=${c.fingerprint256 || '—'} · valido fino a ${c.validTo || '—'}`)
      })
    }

    const h = result.layers?.http
    if (h) L.push(`[HTTP] ${String(h.status).toUpperCase()}${h.ms != null ? ` · ${h.ms}ms` : ''}${h.httpStatus != null ? ` · HTTP ${h.httpStatus}` : ''}${h.error ? ` · errore: ${h.code || ''} ${h.error}` : ''}${h.reason ? ` · ${h.reason}` : ''}`)

    if (result.proxy) {
      L.push('')
      L.push(`[PROXY] resolveProxy: ${result.proxy.resolved || '—'} · usingProxy=${result.proxy.usingProxy}`)
      L.push(`        env: HTTP_PROXY=${result.proxy.env.HTTP_PROXY || '—'} HTTPS_PROXY=${result.proxy.env.HTTPS_PROXY || '—'} NO_PROXY=${result.proxy.env.NO_PROXY || '—'}`)
    }

    if (result.controls?.length) {
      L.push('')
      L.push('[CONTROLLI] confronto a tre vie:')
      result.controls.forEach(c => L.push(`        ${String(c.status).toUpperCase().padEnd(5)} ${c.label}${c.httpStatus != null ? ` · HTTP ${c.httpStatus}` : ''}${c.ms != null ? ` · ${c.ms}ms` : ''}${c.error ? ` · ${c.error}` : ''}`))
    }
    L.push(sep)
  }

  if (quickReport) {
    L.push('CHECK RAPIDI:')
    L.push(quickReport)
  }
  return L.join('\n')
}
