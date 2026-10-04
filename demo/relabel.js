// Etichette "neutre" per la presentazione: il prodotto nasce per le polizze, ma
// la demo lo mostra su fatture, contratti, DDT… Sostituisce SOLO il testo a
// video (text node + placeholder/title) in fase di screenshot; il codice
// dell'app non viene toccato. Iniettato da capture.mjs con addInitScript.
(() => {
  const EXACT = new Map([
    ['🛡️ Polizze', '🗂️ Pratiche'],
    ['Estrazione automatica dati da polizze Responsabilità Civile (RCT/O/P) · fogli Excel RCT_O e RCP',
      'Estrazione automatica dati da pratiche multi-documento (contratti, allegati, fatture) · export Excel'],
    ['Trascina i PDF della polizza', 'Trascina i PDF della pratica'],
    ['Carica tutti i documenti: polizza, appendici, condizioni', 'Carica tutti i documenti: contratto, addendum, listini, fatture'],
    ['⚡ Estrai dati polizza', '⚡ Estrai dati'],
    ['＋ Nuova polizza', '＋ Nuova pratica'],
    ['Polizze RC — campi e mappatura Excel', 'Campi di estrazione e mappatura Excel'],
    ['Salva campi polizza', 'Salva campi'],
    ['Profili polizza (JSON)', 'Profili documento (JSON)'],
    ["Indicazioni aggiuntive per l'estrazione delle polizze…", "Indicazioni aggiuntive per l'estrazione…"],
    ['es. polizza, 2025', 'es. fatture, 2026'],
    ["es. 'responsabilità civile, RCT, RCO'", "es. 'fattura, imponibile, IVA'"],
    ['Seleziona la cartella cliente (es. dalla share di rete): ogni sottocartella viene elaborata come una polizza separata',
      'Seleziona una cartella (es. dalla share di rete): ogni sottocartella viene elaborata come una pratica separata'],
    ['Batch di polizze avviati: stato ed esito, anche dopo aver chiuso il browser', 'Batch di documenti avviati: stato ed esito, anche dopo aver chiuso il browser'],
    ['✓ Gestionale CSA riconosciuto — mappatura automatica', '✓ Gestionale riconosciuto — mappatura automatica'],
  ])
  // Fallback generico (stesso genere: polizza → pratica).
  const RULES = [
    [/polizze/g, 'pratiche'], [/Polizze/g, 'Pratiche'], [/POLIZZE/g, 'PRATICHE'],
    [/polizza/g, 'pratica'], [/Polizza/g, 'Pratica'], [/POLIZZA/g, 'PRATICA'],
    [/ \(RCT\/O\/P\)/g, ''], [/\bRCT_O e RCP\b/g, ''], [/^1 pagine\b/, '1 pagina'], [/OCR visivo completato/, 'Estrazione completata'],
    [/verifica che questa copertura sia OPERANTE nei documenti e cita la prova/, 'verifica che il contenuto dei documenti corrisponda a questo profilo e cita la prova'],
  ]
  // Mai toccare CSS/JS inline: le classi delle pagine contengono "polizza".
  const SKIP = new Set(['STYLE', 'SCRIPT', 'NOSCRIPT', 'TEXTAREA'])
  const fix = (s) => {
    if (!s) return s
    const t = s.trim()
    if (EXACT.has(t)) return s.replace(t, EXACT.get(t))
    let out = s
    for (const [re, rep] of RULES) out = out.replace(re, rep)
    return out
  }
  const walk = (root) => {
    if (root.nodeType === 1 && SKIP.has(root.nodeName)) return
    const tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => (SKIP.has(n.parentNode && n.parentNode.nodeName) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
    })
    let n
    while ((n = tw.nextNode())) { const v = fix(n.nodeValue); if (v !== n.nodeValue) n.nodeValue = v }
    const els = root.querySelectorAll ? root.querySelectorAll('[placeholder],[title]') : []
    for (const el of els) {
      for (const a of ['placeholder', 'title']) {
        const v = el.getAttribute(a); if (v) { const f = fix(v); if (f !== v) el.setAttribute(a, f) }
      }
    }
  }
  const start = () => {
    walk(document.body)
    new MutationObserver((muts) => {
      for (const m of muts) {
        if (m.type === 'characterData') { if (SKIP.has(m.target.parentNode && m.target.parentNode.nodeName)) continue; const v = fix(m.target.nodeValue); if (v !== m.target.nodeValue) m.target.nodeValue = v }
        for (const node of m.addedNodes || []) {
          if (node.nodeType === 3) { if (SKIP.has(node.parentNode && node.parentNode.nodeName)) continue; const v = fix(node.nodeValue); if (v !== node.nodeValue) node.nodeValue = v }
          else if (node.nodeType === 1) walk(node)
        }
      }
    }).observe(document.body, { childList: true, subtree: true, characterData: true })
  }
  if (document.body) start(); else document.addEventListener('DOMContentLoaded', start)
})()
