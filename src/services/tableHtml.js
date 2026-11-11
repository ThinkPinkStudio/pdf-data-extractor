/**
 * TABELLE DELLE SCANSIONI (flag `tabelleocr`, 08/10/2026).
 *
 * Il modello visivo che trascrive le scansioni (qwen3-vl) separa le celle con
 * spazi ma non le incolonna e salta le celle vuote: «€ 18,67  € 2,33  € 21,00»
 * sotto cinque intestazioni non dice di quale colonna è ogni importo. Le
 * tabelle si ricostruiscono a parte: un rilevatore di layout (PP-DocLayoutV2
 * nel servizio Docling) trova i riquadri, un modello per tabelle (GLM-OCR,
 * «Table Recognition:») restituisce ogni ritaglio in HTML con le celle
 * esplicite, anche vuote o unite. Qui l'HTML diventa una griglia incolonnata
 * come quella delle pagine digitali, così le regole che leggono la cella
 * SOTTO l'intestazione valgono anche per le scansioni.
 */

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#x27': "'", '#39': "'" }
const decode = (s) => String(s).replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) => {
  if (ENTITIES[e.toLowerCase()] != null) return ENTITIES[e.toLowerCase()]
  if (/^#x/i.test(e)) return String.fromCodePoint(parseInt(e.slice(2), 16))
  if (/^#\d/.test(e)) return String.fromCodePoint(parseInt(e.slice(1), 10))
  return m
})

/**
 * Righe di una tabella HTML: per ogni riga le celle {text, span}. Solo la
 * PRIMA tabella (i modelli a volte la ripetono), tag interni tolti, a capo
 * nella cella = spazio.
 * @param {string} html
 * @returns {{text:string, span:number}[][]}
 */
export function parseHtmlTable(html) {
  let s = String(html || '')
  const end = s.indexOf('</table>')
  if (end >= 0) s = s.slice(0, end)
  const rows = []
  for (const tr of s.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = []
    for (const c of tr[1].matchAll(/<t([hd])([^>]*)>([\s\S]*?)<\/t\1>/gi)) {
      const span = Math.max(1, Math.min(20, Number((c[2].match(/colspan\s*=\s*["']?(\d+)/i) || [])[1]) || 1))
      const text = decode(c[3].replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim()
      cells.push({ text, span })
    }
    if (cells.length) rows.push(cells)
  }
  return rows
}

/**
 * La tabella come griglia di testo incolonnata: ogni colonna larga quanto la
 * sua cella più lunga, tre spazi tra le colonne, una cella unita occupa la
 * larghezza delle colonne che copre (un'intestazione su due colonne sta sopra
 * entrambe), le celle vuote restano spazi. Righe vuote tolte.
 * @param {string} html
 * @returns {string} '' se non c'è una tabella con almeno due righe
 */
export function htmlTableToGrid(html) {
  const rows = parseHtmlTable(html).filter((r) => r.some((c) => c.text))
  if (rows.length < 2) return ''
  const n = Math.max(...rows.map((r) => r.reduce((a, c) => a + c.span, 0)))
  const GAP = 3
  const width = new Array(n).fill(0)
  // larghezze dalle celle singole, poi le unite allargano l'ultima colonna coperta
  const placed = rows.map((r) => { let col = 0; return r.map((c) => { const p = { ...c, col }; col += c.span; return p }) })
  for (const r of placed) for (const c of r) if (c.span === 1 && c.col < n) width[c.col] = Math.max(width[c.col], c.text.length)
  for (const r of placed) for (const c of r) {
    if (c.span === 1 || c.col >= n) continue
    const last = Math.min(n, c.col + c.span) - 1
    let have = 0
    for (let k = c.col; k <= last; k++) have += width[k] + (k > c.col ? GAP : 0)
    if (c.text.length > have) width[last] += c.text.length - have
  }
  const lines = placed.map((r) => {
    let line = ''
    let col = 0
    for (const c of r) {
      while (col < c.col) { line += ' '.repeat(width[col] + GAP); col++ }
      const last = Math.min(n, c.col + c.span) - 1
      let w = 0
      for (let k = c.col; k <= last; k++) w += width[k] + (k > c.col ? GAP : 0)
      line += c.text.padEnd(w) + ' '.repeat(GAP)
      col = last + 1
    }
    return line.trimEnd()
  })
  return lines.join('\n')
}
