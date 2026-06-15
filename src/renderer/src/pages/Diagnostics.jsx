import { useState, useEffect, useRef, useCallback } from 'react'

// ─── Pagina Sicurezza / Diagnostica ──────────────────────────────────────────
// Esegue, uno per uno, tutti i controlli utili a capire perché l'estrazione/OCR
// non funziona su una data macchina. I check sono condizionati al provider AI
// attivo (Ollama → check Ollama; Anthropic/OpenAI → rete/TLS + credenziali).

const NET_STAGES = ['tls', 'connect', 'proxy', 'dns', 'timeout', 'network']

const provLabel = (p) => (p === 'openai' ? 'OpenAI' : p === 'anthropic' ? 'Anthropic' : p === 'none' ? 'Nessuno' : 'Ollama')
const platName = (p) => ({ win32: 'Windows', darwin: 'macOS', linux: 'Linux' }[p] || p)
const statusLabel = (st) => ({ ok: 'OK', warn: 'ATTENZIONE', fail: 'ERRORE', skip: 'SALTATO', running: '…', pending: '—' }[st] || st)

// Verdetti "gravi" (colpa della rete del cliente o assenza connessione) →
// banner rosso; auth/proxy/unknown → giallo; all-ok → verde.
const VERDICT_ERROR = ['tls-interception', 'tls-blocked', 'dns-blocked', 'egress-blocked', 'captive-portal', 'no-internet', 'error']
const verdictAlertClass = (v) =>
  VERDICT_ERROR.includes(v) ? 'alert-error' : v === 'all-ok' ? 'alert-success' : 'alert-warning'

// Costruisce il testo del report rapido (riusato sia per "Copia report" sia per
// l'export del report completo).
function buildQuickReport({ checks, results, sysInfo, provider }) {
  const lines = []
  lines.push('PDF Data Extractor — Report diagnostica')
  lines.push(new Date().toLocaleString())
  if (sysInfo) lines.push(`Sistema: ${platName(sysInfo.platform)} ${sysInfo.arch} · App v${sysInfo.appVersion} · Electron ${sysInfo.electron}`)
  lines.push(`Provider AI: ${provLabel(provider)}`)
  lines.push('')
  checks.forEach(c => {
    const r = results[c.id] || {}
    lines.push(`[${statusLabel(r.status)}] ${c.label}${r.detail ? ` — ${r.detail}` : ''}`)
  })
  return lines.join('\n')
}

// Trasforma il risultato della diagnostica approfondita in card visualizzabili.
function deepCards(deep) {
  if (!deep || !deep.layers) return []
  const cards = []
  const L = deep.layers

  if (L.dns) {
    const d = L.dns
    cards.push({
      id: 'deep-dns', label: 'DNS — risoluzione dominio', status: d.status,
      detail: d.status === 'ok'
        ? `IP: ${(d.ips || []).join(', ') || '—'} · server DNS: ${(d.servers || []).join(', ') || '—'} · ${d.ms}ms`
        : `${d.code || 'errore'}: ${d.error || 'risoluzione fallita'} · server DNS: ${(d.servers || []).join(', ') || '—'}`
    })
  }
  if (L.tcp) {
    const t = L.tcp
    cards.push({
      id: 'deep-tcp', label: 'TCP — connessione :443', status: t.status,
      detail: t.status === 'ok' ? `Connesso a ${t.peer} · ${t.ms}ms`
        : t.status === 'skip' ? (t.reason || 'saltato')
          : `${t.code || 'errore'}: ${t.error || 'connessione fallita'}`
    })
  }
  if (L.tls) {
    const tl = L.tls
    const parts = []
    if (tl.protocol) parts.push(tl.protocol)
    if (tl.cipher) parts.push(tl.cipher)
    if (tl.ms != null) parts.push(`${tl.ms}ms`)
    cards.push({
      id: 'deep-tls', label: 'TLS — handshake ed emittente certificato', status: tl.status,
      detail: tl.status === 'skip' ? (tl.reason || 'saltato')
        : tl.status === 'fail' ? `${tl.code || 'errore'}: ${tl.error || 'handshake fallito'}`
          : `${parts.join(' · ')} · Emittente root: ${tl.rootIssuer || '—'}`,
      emphasis: tl.intercepted ? tl.interceptionReason : null,
      note: !tl.intercepted && tl.suspicious ? tl.suspicionReason : null,
      chain: tl.chain || []
    })
  }
  if (L.http) {
    const h = L.http
    cards.push({
      id: 'deep-http', label: 'HTTP — risposta endpoint', status: h.status,
      detail: h.status === 'skip' ? (h.reason || 'saltato')
        : h.status === 'ok' ? `HTTP ${h.httpStatus} · ${h.ms}ms (qualunque risposta = rete/proxy/TLS OK)`
          : `${h.code || 'errore'}: ${h.error || 'nessuna risposta'}`
    })
  }
  if (deep.proxy) {
    const p = deep.proxy
    cards.push({
      id: 'deep-proxy', label: 'Proxy di sistema', status: p.usingProxy ? 'warn' : 'ok',
      detail: `resolveProxy: ${p.resolved || '—'} · HTTPS_PROXY=${p.env?.HTTPS_PROXY || '(nessuno)'} · HTTP_PROXY=${p.env?.HTTP_PROXY || '(nessuno)'}`
    })
  }
  return cards
}

function StatusDot({ status }) {
  if (status === 'running') return <div className="spinner spinner-sm" aria-hidden="true" />
  const map = {
    ok:      { bg: 'rgba(34,197,94,0.15)',  fg: 'var(--c-success)', ch: '✓' },
    warn:    { bg: 'rgba(234,179,8,0.15)',   fg: '#b45309',          ch: '!' },
    fail:    { bg: 'rgba(239,68,68,0.15)',   fg: 'var(--c-error)',   ch: '✕' },
    skip:    { bg: 'rgba(120,120,120,0.15)', fg: 'var(--c-text-dim, #888)', ch: '–' },
    pending: { bg: 'rgba(120,120,120,0.10)', fg: 'var(--c-text-dim, #888)', ch: '·' }
  }
  const s = map[status] || map.pending
  return (
    <span aria-hidden="true" style={{
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      width: 20, height: 20, borderRadius: '50%', flexShrink: 0,
      background: s.bg, color: s.fg, fontSize: 12, fontWeight: 700
    }}>{s.ch}</span>
  )
}

// Costruisce l'elenco ordinato dei check in base alle impostazioni.
// `ctx` è un oggetto condiviso tra i check (es. il risultato del test di rete
// viene riusato dal check di autenticazione).
function buildCheckDefs(s, ctx) {
  const provider = s.llmProvider || 'ollama'
  const defs = []

  defs.push({
    id: 'system', label: 'Sistema e versione app',
    run: async () => {
      const info = await window.electronAPI.getDiagnosticsSystem()
      ctx.sys = info
      return { status: 'ok', detail: `${platName(info.platform)} ${info.arch} · App v${info.appVersion} · Electron ${info.electron} · Chrome ${info.chrome}` }
    }
  })

  defs.push({
    id: 'online', label: 'Connessione a internet',
    run: async () => navigator.onLine
      ? { status: 'ok', detail: 'Il sistema risulta online.' }
      : { status: 'warn', detail: 'Il sistema risulta offline. Controlla rete/Wi-Fi.' }
  })

  defs.push({
    id: 'provider', label: 'Provider AI attivo',
    run: async () => provider === 'none'
      ? { status: 'warn', detail: "Nessun provider selezionato: l'estrazione AI e l'OCR sono disabilitati." }
      : { status: 'ok', detail: `Provider configurato: ${provLabel(provider)}.` }
  })

  if (provider === 'ollama') {
    const url = s.ollamaUrl || 'http://127.0.0.1:11434'
    defs.push({
      id: 'ollama-reach', label: 'Ollama raggiungibile',
      run: async () => {
        const st = await window.electronAPI.getOllamaStatusUrl(url)
        ctx.ollama = st
        return st.connected
          ? { status: 'ok', detail: `Connesso a ${url} · ${st.models.length} modelli installati.` }
          : { status: 'fail', detail: `Ollama non raggiungibile su ${url}. Avvia Ollama ("ollama serve") o correggi l'URL nelle Impostazioni.` }
      }
    })
    defs.push({
      id: 'ollama-text-model', label: 'Modello testo configurato',
      run: async () => {
        if (!s.ollamaModel) return { status: 'warn', detail: 'Nessun modello testo impostato nelle Impostazioni.' }
        const installed = ctx.ollama?.models || []
        if (ctx.ollama && ctx.ollama.connected && !installed.includes(s.ollamaModel)) {
          return { status: 'warn', detail: `"${s.ollamaModel}" non risulta installato. Installati: ${installed.join(', ') || 'nessuno'}.` }
        }
        return { status: 'ok', detail: `Modello: ${s.ollamaModel}.` }
      }
    })
    defs.push({
      id: 'ollama-vision-model', label: 'Modello vision (PDF scansionati / OCR)',
      run: async () => {
        const vm = s.ollamaVisionModel || s.ollamaModel
        if (!vm) return { status: 'warn', detail: 'Nessun modello vision impostato: i PDF scansionati non potranno essere letti. Imposta es. llava, minicpm-v o llama3.2-vision.' }
        const installed = ctx.ollama?.models || []
        if (ctx.ollama && ctx.ollama.connected && !installed.includes(vm)) {
          return { status: 'warn', detail: `Il modello vision "${vm}" non risulta installato.` }
        }
        return { status: 'ok', detail: `Modello vision: ${vm}.` }
      }
    })
  }

  if (provider === 'anthropic' || provider === 'openai') {
    const isA = provider === 'anthropic'
    const keyField = isA ? s.anthropicApiKey : s.openaiApiKey
    const modelField = isA ? s.anthropicModel : s.openaiModel
    const domain = isA ? 'api.anthropic.com' : 'api.openai.com'

    defs.push({
      id: 'cloud-key', label: 'API key impostata',
      run: async () => keyField
        ? { status: 'ok', detail: 'API key presente.' }
        : { status: 'fail', detail: `Nessuna API key ${provLabel(provider)} impostata nelle Impostazioni.` }
    })
    defs.push({
      id: 'cloud-net', label: `Rete / proxy / TLS verso ${domain}`,
      run: async () => {
        const res = await window.electronAPI.testConnection()
        ctx.conn = res
        if (res.ok || !NET_STAGES.includes(res.stage)) {
          return { status: 'ok', detail: 'Endpoint raggiungibile: rete, proxy e TLS funzionano.' }
        }
        return { status: 'fail', detail: `${res.message} Segnala al supporto IT: potrebbe servire autorizzare ${domain} o installare la CA aziendale.` }
      }
    })
    defs.push({
      id: 'cloud-auth', label: 'Autenticazione (API key valida)',
      run: async () => {
        const res = ctx.conn
        if (!res) return { status: 'skip', detail: 'Test non eseguito.' }
        if (!res.ok && NET_STAGES.includes(res.stage)) return { status: 'skip', detail: 'Saltato: problema di rete a monte.' }
        if (res.stage === 'auth') return { status: 'fail', detail: `API key rifiutata dal provider (HTTP ${res.status}). Controlla la chiave.` }
        if (res.ok) return { status: 'ok', detail: 'Credenziali accettate dal provider.' }
        return { status: 'warn', detail: res.message }
      }
    })
    defs.push({
      id: 'cloud-model', label: 'Modello impostato',
      run: async () => modelField
        ? { status: 'ok', detail: `Modello: ${modelField}.` }
        : { status: 'warn', detail: 'Nessun modello impostato: verrà usato il default.' }
    })
  }

  return defs
}

export default function Diagnostics({ visible }) {
  const [settings, setSettings] = useState(null)
  const [checks, setChecks] = useState([])      // [{ id, label }]
  const [results, setResults] = useState({})    // id -> { status, detail }
  const [running, setRunning] = useState(false)
  const [sysInfo, setSysInfo] = useState(null)
  const [copied, setCopied] = useState(false)
  const [deep, setDeep] = useState(null)
  const [deepRunning, setDeepRunning] = useState(false)
  const [exportMsg, setExportMsg] = useState('')
  const hasAutoRun = useRef(false)

  useEffect(() => {
    window.electronAPI.getSettings().then(setSettings)
  }, [])

  const runAll = useCallback(async (s) => {
    if (!s || running) return
    setRunning(true)
    setCopied(false)
    const ctx = {}
    const defs = buildCheckDefs(s, ctx)
    setChecks(defs.map(d => ({ id: d.id, label: d.label })))
    setResults(Object.fromEntries(defs.map(d => [d.id, { status: 'pending' }])))
    for (const d of defs) {
      setResults(r => ({ ...r, [d.id]: { status: 'running' } }))
      let res
      try { res = await d.run() } catch (e) { res = { status: 'fail', detail: e?.message || 'errore' } }
      setResults(r => ({ ...r, [d.id]: res }))
    }
    if (ctx.sys) setSysInfo(ctx.sys)
    setRunning(false)
  }, [running])

  // Esecuzione automatica la prima volta che la pagina diventa visibile.
  useEffect(() => {
    if (visible && settings && !hasAutoRun.current) {
      hasAutoRun.current = true
      runAll(settings)
    }
  }, [visible, settings, runAll])

  const provider = settings?.llmProvider || 'ollama'
  const isCloud = provider === 'anthropic' || provider === 'openai'

  const copyReport = async () => {
    let text = buildQuickReport({ checks, results, sysInfo, provider })
    if (deep) {
      text += `\n\n── Diagnostica approfondita ──\nVERDETTO: ${deep.verdict}\n${deep.verdictText || ''}`
      if (deep.layers?.tls?.rootIssuer) text += `\nEmittente certificato: ${deep.layers.tls.rootIssuer}`
    }
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2500)
    } catch { /* clipboard non disponibile */ }
  }

  const runDeep = useCallback(async () => {
    setDeepRunning(true)
    setExportMsg('')
    try {
      const res = await window.electronAPI.deepNetworkDiagnostics()
      setDeep(res)
    } catch (e) {
      setDeep({ verdict: 'error', verdictText: e?.message || 'errore', layers: {}, controls: [] })
    } finally {
      setDeepRunning(false)
    }
  }, [])

  const exportFull = async () => {
    setExportMsg('')
    const quickReport = buildQuickReport({ checks, results, sysInfo, provider })
    try {
      const res = await window.electronAPI.exportDiagnosticsReport({ result: deep, quickReport, system: sysInfo })
      if (res?.success) setExportMsg(`✓ Report salvato: ${res.filePath}`)
      else if (res?.canceled) setExportMsg('')
      else setExportMsg(`Errore esportazione: ${res?.error || 'sconosciuto'}`)
    } catch (e) {
      setExportMsg(`Errore esportazione: ${e?.message || 'sconosciuto'}`)
    }
  }

  const openLogs = async () => {
    try { await window.electronAPI.openDiagnosticsLogFolder() } catch { /* noop */ }
  }

  const deepResultCards = deepCards(deep)

  const hasFailures = checks.some(c => results[c.id]?.status === 'fail')
  const hasWarnings = checks.some(c => results[c.id]?.status === 'warn')

  return (
    <>
      <div className="page-header">
        <h1 className="page-title">Sicurezza e diagnostica</h1>
        <p className="page-subtitle">
          Controlli su rete, provider AI e configurazione. Utile per capire perché
          l'estrazione o l'OCR non funziona su una macchina (es. dietro VPN/firewall aziendali).
        </p>
      </div>

      <div className="page-body">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 760 }}>

          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <button className="btn btn-primary" onClick={() => runAll(settings)} disabled={running || !settings}>
              {running ? <div className="spinner spinner-sm" aria-hidden="true" /> : '▶'}
              {running ? 'Diagnostica in corso…' : 'Esegui diagnostica'}
            </button>
            <button className="btn btn-secondary" onClick={copyReport} disabled={running || checks.length === 0}>
              {copied ? '✓ Copiato' : '📋 Copia report'}
            </button>
            <span style={{ fontSize: 13, opacity: 0.75 }}>
              Provider attivo: <strong>{provLabel(provider)}</strong>
            </span>
          </div>

          {isCloud && (
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <button className="btn btn-primary" onClick={runDeep} disabled={deepRunning}>
                {deepRunning ? <div className="spinner spinner-sm" aria-hidden="true" /> : '🔬'}
                {deepRunning ? 'Analisi approfondita…' : 'Esegui diagnostica approfondita'}
              </button>
              <button className="btn btn-secondary" onClick={exportFull} disabled={deepRunning}>
                💾 Esporta report completo
              </button>
              <button className="btn btn-secondary" onClick={openLogs}>
                📁 Apri cartella log
              </button>
            </div>
          )}

          {exportMsg && (
            <div style={{ fontSize: 12, opacity: 0.85, wordBreak: 'break-all' }}>{exportMsg}</div>
          )}

          {checks.length > 0 && !running && (
            <div
              className={`alert ${hasFailures ? 'alert-error' : hasWarnings ? 'alert-warning' : 'alert-success'}`}
              style={{ padding: '10px 12px', fontSize: 13 }}
              role="status"
            >
              {hasFailures
                ? '⚠ Rilevati problemi che impediscono il funzionamento. Vedi i dettagli e usa «Copia report» per il supporto.'
                : hasWarnings
                  ? 'Tutto funzionante, con alcuni avvisi di configurazione.'
                  : '✓ Tutti i controlli superati.'}
            </div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {checks.map(c => {
              const r = results[c.id] || { status: 'pending' }
              return (
                <div key={c.id} style={{
                  display: 'flex', gap: 12, alignItems: 'flex-start',
                  padding: '10px 12px', borderRadius: 'var(--r-sm, 8px)',
                  border: '1px solid var(--c-border, rgba(128,128,128,0.2))',
                  background: 'var(--c-surface, rgba(128,128,128,0.04))'
                }}>
                  <div style={{ paddingTop: 1 }}><StatusDot status={r.status} /></div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                    <span style={{ fontSize: 13, fontWeight: 600 }}>{c.label}</span>
                    {r.detail && (
                      <span style={{ fontSize: 12, opacity: 0.8, lineHeight: 1.4, wordBreak: 'break-word' }}>
                        {r.detail}
                      </span>
                    )}
                  </div>
                </div>
              )
            })}
            {checks.length === 0 && (
              <p style={{ fontSize: 13, opacity: 0.7 }}>
                Premi «Esegui diagnostica» per avviare i controlli.
              </p>
            )}
          </div>

          {deep && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
              <h2 style={{ fontSize: 15, fontWeight: 700, margin: '4px 0' }}>Diagnostica approfondita</h2>

              {deep.verdictText && (
                <div
                  className={`alert ${verdictAlertClass(deep.verdict)}`}
                  style={{ padding: '10px 12px', fontSize: 13 }}
                  role="status"
                >
                  <strong>Verdetto: {deep.verdict}</strong><br />
                  {deep.verdictText}
                </div>
              )}

              {deepResultCards.map(c => (
                <div key={c.id} style={{
                  display: 'flex', gap: 12, alignItems: 'flex-start',
                  padding: '10px 12px', borderRadius: 'var(--r-sm, 8px)',
                  border: '1px solid var(--c-border, rgba(128,128,128,0.2))',
                  background: 'var(--c-surface, rgba(128,128,128,0.04))'
                }}>
                  <div style={{ paddingTop: 1 }}><StatusDot status={c.status} /></div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                    <span style={{ fontSize: 13, fontWeight: 600 }}>{c.label}</span>
                    {c.detail && (
                      <span style={{ fontSize: 12, opacity: 0.8, lineHeight: 1.4, wordBreak: 'break-word' }}>{c.detail}</span>
                    )}
                    {c.emphasis && (
                      <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--c-error)', lineHeight: 1.4, wordBreak: 'break-word' }}>
                        ⚠ {c.emphasis}
                      </span>
                    )}
                    {c.note && (
                      <span style={{ fontSize: 12, fontWeight: 600, color: '#b45309', lineHeight: 1.4, wordBreak: 'break-word' }}>
                        ⚠ {c.note}
                      </span>
                    )}
                    {c.chain && c.chain.length > 0 && (
                      <details style={{ fontSize: 11, opacity: 0.75, marginTop: 2 }}>
                        <summary style={{ cursor: 'pointer' }}>Catena certificati ({c.chain.length})</summary>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 4 }}>
                          {c.chain.map((cert, i) => (
                            <div key={i} style={{ fontFamily: 'monospace', wordBreak: 'break-all' }}>
                              [{i}] subject CN={cert.subjectCN || '—'} O={cert.subjectO || '—'}<br />
                              &nbsp;&nbsp;&nbsp;&nbsp;issuer CN={cert.issuerCN || '—'} O={cert.issuerO || '—'}<br />
                              &nbsp;&nbsp;&nbsp;&nbsp;valido fino a {cert.validTo || '—'}
                            </div>
                          ))}
                        </div>
                      </details>
                    )}
                  </div>
                </div>
              ))}

              {deep.controls && deep.controls.length > 0 && (
                <div style={{
                  padding: '10px 12px', borderRadius: 'var(--r-sm, 8px)',
                  border: '1px solid var(--c-border, rgba(128,128,128,0.2))',
                  background: 'var(--c-surface, rgba(128,128,128,0.04))'
                }}>
                  <span style={{ fontSize: 13, fontWeight: 600 }}>Endpoint di controllo (confronto a tre vie)</span>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 6 }}>
                    {deep.controls.map(ctl => (
                      <div key={ctl.id} style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                        <StatusDot status={ctl.status} />
                        <span style={{ fontSize: 12, opacity: 0.85 }}>
                          {ctl.label}{ctl.httpStatus != null ? ` · HTTP ${ctl.httpStatus}` : ''}{ctl.note ? ` (${ctl.note})` : ''}{ctl.ms != null ? ` · ${ctl.ms}ms` : ''}{ctl.error ? ` · ${ctl.error}` : ''}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

        </div>
      </div>
    </>
  )
}
