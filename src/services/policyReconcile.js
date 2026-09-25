/**
 * RICONCILIAZIONE dei dossier di un batch per NUMERO DI POLIZZA — parte PURA.
 *
 * Il bulk propone un dossier per cartella. Nelle cartelle reali i pezzi di UNA
 * polizza stanno spesso in sottocartelle («BESA TUT. LEGALE PENALE AZIENDA» con
 * la polizza firmata e la regolazione, e «…/POLIZZA» con polizza e appendice:
 * due dossier, due righe, uno dei due «da verificare»). Nessuna regola sulla
 * STRUTTURA separa i pezzi dalle polizze diverse: «COI TECHNOLOGY SRL» ha 3
 * file sciolti e 18 sottocartelle, ognuna una polizza; «…/preventivi» sono
 * offerte d'altri; «COSTA 1A/TUT. LEGALE» è una seconda polizza. Decide la
 * PROVA: lo stesso numero di polizza stampato nei documenti. Mai il nome della
 * cartella o del file, mai il tipo di documento.
 *
 * Regole (type-blind):
 *  - dentro un dossier, i file si collegano se condividono un numero; se tutti
 *    i file numerati formano UN gruppo il dossier è UNA posizione (i file senza
 *    numero — set informativo, condizioni — la seguono); se i gruppi sono più
 *    d'uno il dossier è un CONTENITORE di polizze diverse e si spostano solo i
 *    file che portano il numero, mai gli altri;
 *  - due posizioni con un numero in comune sono la STESSA polizza e si uniscono
 *    nel dossier della posizione dal percorso più corto (la cartella madre);
 *  - un gruppo fatto solo di pezzi di contenitori non ha dove andare: resta
 *    com'è (meglio separato che mescolato);
 *  - una cartella SENZA alcun numero di polizza (solo set informativo,
 *    condizioni) che sotto di sé ha UNA sola polizza ne fa parte («COI … TUT.
 *    LEGALE PENALE» col solo set informativo, sopra «…/POLIZZA»); con due o più
 *    polizze sotto resta com'è; una polizza sotto di lei che si unisce a una
 *    cartella di FUORI (copia archiviata nel posto sbagliato) non conta;
 *  - mai come numero di polizza un codice fiscale di persona o un numero che
 *    il documento etichetta come partita IVA / codice fiscale;
 *  - il dossier unito prende il percorso più corto tra quelli uniti (la
 *    cartella madre), non quello di «…/POLIZZA».
 */

// Numero dopo un'etichetta di polizza: «Polizza n. 01469DAS00040», «N. polizza
// 212.044.0000902142», «Polizza N° 556129374», «numero di polizza: M16214347».
// Frammenti di sole cifre staccati da UNO spazio in coda al numero sono il
// kerning del text layer («01469DAS000 40» = «01469DAS00040»), come in
// joinSplitNumbers: si riattaccano solo se dopo non viene una lettera, una
// barra o un punto («n. 123456 del 2024», «123456 12/2024» restano fuori).
const LABELLED_NUM_RE = /(?:polizz[ae]?\s*(?:n(?:um(?:ero)?)?\s*[.:°º]?|nr\.?)|n(?:um(?:ero)?)?\s*[.:°º]?\s*(?:di\s+)?polizz[ae]?)\s*[:.]?\s*([A-Z0-9][A-Z0-9./\-]{4,24}(?: \d{1,4}(?![\dA-Za-z/.]))*)/gi

// Forma di un CODICE FISCALE di persona (omocodia compresa): sei lettere, anno,
// mese (lettera), giorno, comune, controllo. Stampato vicino a «polizza» nei
// moduli (BESA, RUZZA FABIO: «RZZFBA62T30F205P» letto come numero): è la
// persona, uguale in TUTTE le sue polizze, e le unirebbe tutte.
const PERSON_CF_RE = /^[A-Z]{6}[\dLMNPQRSTUV]{2}[ABCDEHLMPRST][\dLMNPQRSTUV]{2}[A-Z][\dLMNPQRSTUV]{3}[A-Z]$/

/**
 * Forma canonica di un numero: maiuscolo, senza separatori né zeri iniziali
 * («00556129374» = «556129374», «212.044.0000902142» = «2120440000902142»).
 * Un codice con meno di 5 cifre non è un numero di polizza («n. 1», «Mod. 2122»),
 * un codice fiscale di persona nemmeno.
 */
export function normalizePolicyNumber(raw) {
  const s = String(raw || '').toUpperCase().replace(/[\s./\-_]+/g, '').replace(/^0+/, '')
  if (PERSON_CF_RE.test(s)) return ''
  return (s.match(/\d/g) || []).length >= 5 ? s : ''
}

// Numero dopo un'etichetta FISCALE sulla stessa riga («PARTITA IVA: 13251900158»,
// «P.IVA/C.F. 01234567890», «Codice fiscale 80012345678»): è il contraente,
// non la polizza, anche quando la stessa cifra finisce vicino a «polizza».
const FISCAL_NUM_RE = /(?:\bpartita\s+iva|\bp\.?\s*i\.?\s*v\.?\s*a\b\.?|\bcod(?:ice)?\.?\s*fisc(?:ale)?\b\.?|\bc\.\s*f\.)\s*[:.]?\s*(?:\/\s*(?:c\.\s*f\.|cod(?:ice)?\.?\s*fisc(?:ale)?\.?)\s*[:.]?\s*)?([A-Z0-9]{11,16})\b/gi

/** Numeri che nel testo stanno dopo un'etichetta fiscale (forma canonica). */
export function fiscalNumbers(text) {
  const out = new Set()
  for (const m of String(text || '').matchAll(FISCAL_NUM_RE)) {
    const s = m[1].toUpperCase().replace(/^0+/, '')
    if (s) out.add(s)
  }
  return out
}

/** Numeri di polizza citati con la loro etichetta nel testo (forma canonica, senza doppioni). */
export function extractPolicyNumbers(text) {
  const out = new Set()
  for (const m of String(text || '').matchAll(LABELLED_NUM_RE)) {
    const n = normalizePolicyNumber(m[1].replace(/ /g, '').replace(/[.\-/]+$/, ''))
    if (n) out.add(n)
  }
  return [...out]
}

// Celle di una riga della GRIGLIA spaziale (colonne separate da ≥2 spazi), con la loro colonna.
function gridCells(line) {
  const out = []
  const re = /\S+(?: \S+)*/g
  let m
  while ((m = re.exec(line))) out.push({ text: m[0], start: m.index, end: m.index + m[0].length })
  return out
}

// Cella-etichetta del numero di polizza: nomina la polizza E un numero
// («RAMO / NUMERO POLIZZA», «Polizza Nr.», «N. polizza»). Il numero della
// polizza SOSTITUITA o PRECEDENTE è di un'altra polizza: non lega le due.
const LABEL_CELL_RE = /polizz/i
const LABEL_NUM_RE = /\b(?:n(?:r|um(?:ero)?)?\b\.?|n[°º]|numero)/i
const OTHER_POLICY_RE = /sostituit|precedent/i

/**
 * Numeri di polizza di un documento dalla GRIGLIA spaziale (pagine del text
 * layer o dell'OCR): nella cella dell'etichetta («Polizza n. 01469DAS00040»)
 * oppure SOTTO l'etichetta, nella stessa colonna, nelle righe seguenti (i
 * moduli: «RAMO / NUMERO POLIZZA» e sotto «30/210502137»). Forma canonica.
 * @param {string[]} pages
 */
export function extractPolicyNumbersFromPages(pages) {
  const out = new Set()
  const fiscal = fiscalNumbers((pages || []).join('\n'))
  for (const page of pages || []) {
    const lines = String(page || '').split('\n')
    for (let i = 0; i < lines.length; i++) {
      for (const cell of gridCells(lines[i])) {
        if (!LABEL_CELL_RE.test(cell.text) || OTHER_POLICY_RE.test(cell.text)) continue
        const inline = extractPolicyNumbers(cell.text)
        if (inline.length) { inline.forEach((n) => out.add(n)); continue }
        if (!LABEL_NUM_RE.test(cell.text)) continue
        // Colonna della parola «polizza» nella cella: un'intestazione di modulo
        // sta spesso in UNA cella («COD. AG. COD. SUBAG. RAMO NR. POLIZZA
        // PRODOTTO») e sotto ci sono i valori di tutte le colonne: il numero è
        // quello più vicino alla parola, non il primo (sarebbe il codice agenzia).
        const at = cell.start + cell.text.search(LABEL_CELL_RE)
        for (let k = i + 1; k <= Math.min(i + 3, lines.length - 1); k++) {
          const under = gridCells(lines[k]).filter((c) => c.start < cell.end && c.end > cell.start)
          if (!under.length) continue
          const nums = under.map((c) => ({ c, n: normalizePolicyNumber(c.text.split(/\s+/)[0]) })).filter((x) => x.n)
          if (nums.length) {
            const dist = (c) => (at < c.start ? c.start - at : at > c.end ? at - c.end : 0)
            nums.sort((a, b) => dist(a.c) - dist(b.c))
            out.add(nums[0].n)
          }
          break // la riga sotto l'etichetta ha i suoi valori: il numero c'è o non c'è
        }
      }
    }
  }
  return [...out].filter((n) => !fiscal.has(n))
}

function unionFind() {
  const parent = new Map()
  const find = (x) => { if (!parent.has(x)) parent.set(x, x); let r = x; while (parent.get(r) !== r) r = parent.get(r); parent.set(x, r); return r }
  const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent.set(rb, ra) }
  return { find, union }
}

/**
 * Piano di unione.
 * @param {{id:string, path:string, files:{idx:number, numbers:string[]}[]}[]} dossiers  in ordine di caricamento
 * @returns {{target:string, name:string, numbers:string[], moves:{from:string, all:boolean, idxs:number[]}[]}[]}
 */
export function planReconcile(dossiers) {
  // 0. Un numero che FINISCE con un altro di almeno 8 caratteri è lo stesso col
  // ramo o l'agenzia davanti («30/210502137» e «RAMO 30 · NR. POLIZZA 210502137»).
  const raw = (dossiers || []).filter((d) => d && d.id)
  const all = [...new Set(raw.flatMap((d) => (d.files || []).flatMap((f) => f.numbers || [])))].sort((a, b) => b.length - a.length)
  const canon = new Map()
  for (const num of all) {
    const longer = num.length >= 8 ? all.find((o) => o.length > num.length && o.endsWith(num) && canon.get(o) === o) : null
    canon.set(num, longer || num)
  }
  const list = raw.map((d) => ({ ...d, files: (d.files || []).map((f) => ({ ...f, numbers: [...new Set((f.numbers || []).map((n) => canon.get(n) || n))] })) }))
  // 1. Componenti di file per dossier (file collegati da un numero in comune).
  const nodes = [] // { key, dossier, idxs, numbers:Set, whole }
  for (const d of list) {
    const uf = unionFind()
    const byNum = new Map()
    const numbered = (d.files || []).filter((f) => (f.numbers || []).length)
    for (const f of numbered) {
      for (const n of f.numbers) {
        if (byNum.has(n)) uf.union(`f${byNum.get(n)}`, `f${f.idx}`)
        else byNum.set(n, f.idx)
        uf.find(`f${f.idx}`)
      }
    }
    const comps = new Map()
    for (const f of numbered) {
      const r = uf.find(`f${f.idx}`)
      if (!comps.has(r)) comps.set(r, { idxs: [], numbers: new Set() })
      const c = comps.get(r)
      c.idxs.push(f.idx)
      for (const n of f.numbers) c.numbers.add(n)
    }
    const whole = comps.size === 1
    let k = 0
    for (const c of comps.values()) {
      nodes.push({
        key: `${d.id}#${k++}`, dossier: d, whole,
        idxs: whole ? (d.files || []).map((f) => f.idx) : c.idxs,
        numbers: c.numbers,
      })
    }
  }
  // 2. Posizioni che condividono un numero = stessa polizza.
  const uf = unionFind()
  const firstByNum = new Map()
  for (const n of nodes) {
    uf.find(n.key)
    for (const num of n.numbers) {
      if (firstByNum.has(num)) uf.union(firstByNum.get(num), n.key)
      else firstByNum.set(num, n.key)
    }
  }
  const groups = new Map()
  for (const n of nodes) {
    const r = uf.find(n.key)
    if (!groups.has(r)) groups.set(r, [])
    groups.get(r).push(n)
  }
  // 3. Un'unione per gruppo; destinazione = la posizione dal percorso più corto.
  const order = new Map(list.map((d, i) => [d.id, i]))
  const depth = (p) => String(p || '').split('/').filter(Boolean).length
  const byTarget = new Map() // target → { target, numbers:Set, moves:Map }
  const targetOfDossier = new Map() // dossier «whole» → target del suo gruppo
  for (const g of groups.values()) {
    const wholes = g.filter((n) => n.whole)
    if (!wholes.length) continue // solo pezzi di contenitori: nessuna posizione dove unirli
    wholes.sort((a, b) => depth(a.dossier.path) - depth(b.dossier.path) || order.get(a.dossier.id) - order.get(b.dossier.id))
    const target = wholes[0].dossier.id
    const entry = { target, numbers: new Set(g.flatMap((n) => [...n.numbers])), moves: new Map() }
    for (const n of g) {
      if (n.whole) targetOfDossier.set(n.dossier.id, target)
      if (n.dossier.id === target) continue
      const m = entry.moves.get(n.dossier.id) || { from: n.dossier.id, all: false, idxs: [] }
      if (n.whole) { m.all = true; m.idxs = (n.dossier.files || []).map((f) => f.idx) }
      else if (!m.all) m.idxs.push(...n.idxs)
      entry.moves.set(n.dossier.id, m)
    }
    byTarget.set(target, entry)
  }
  // 4. Cartelle senza numeri con UNA sola polizza sotto di sé. Una posizione
  // sotto la cartella che si unisce a una polizza di FUORI (la copia firmata di
  // un'altra sede archiviata lì: BESA «PREMENUGO/COPIE FIRMATE» con la polizza
  // di Settala) non è «sotto»: resta la polizza di casa.
  const numbered = new Set(nodes.map((n) => n.dossier.id))
  const inside = (p, root) => String(p || '').startsWith(`${root}/`)
  const pathOf = new Map(list.map((d) => [d.id, d.path || '']))
  for (const d of list) {
    if (numbered.has(d.id) || !(d.files || []).length || !d.path) continue
    const below = list.filter((o) => o.id !== d.id && inside(o.path, d.path) && numbered.has(o.id))
    if (!below.length) continue
    const targets = new Set(below
      .map((o) => targetOfDossier.get(o.id) || `container:${o.id}`)
      .filter((t) => t.startsWith('container:') || t === d.id || inside(pathOf.get(t), d.path)))
    if (targets.size !== 1) continue
    const target = [...targets][0]
    if (target.startsWith('container:')) continue
    const entry = byTarget.get(target)
    entry.moves.set(d.id, { from: d.id, all: true, idxs: (d.files || []).map((f) => f.idx) })
  }
  const plan = []
  for (const e of byTarget.values()) {
    if (!e.moves.size) continue
    const merged = [e.target, ...[...e.moves.values()].filter((m) => m.all).map((m) => m.from)]
    const name = merged.map((id) => pathOf.get(id)).sort((a, b) => depth(a) - depth(b) || a.localeCompare(b))[0]
    plan.push({
      target: e.target, name, numbers: [...e.numbers].sort(),
      moves: [...e.moves.values()].map((m) => ({ ...m, idxs: [...new Set(m.idxs)].sort((a, b) => a - b) })),
    })
  }
  return plan
}
