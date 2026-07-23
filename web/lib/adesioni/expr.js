/**
 * Valutatore di espressioni aritmetiche PURO e SICURO (niente eval/Function).
 * Usato per il calcolo del premio tramite formula configurabile.
 *
 * Grammatica supportata:
 *   espr    := somma
 *   somma   := prod ( ('+'|'-') prod )*
 *   prod    := unario ( ('*'|'/'|'%') unario )*
 *   unario  := ('+'|'-') unario | atomo
 *   atomo   := numero | variabile | funzione '(' args ')' | '(' espr ')'
 *
 * Numeri: accetta sia '.' che ',' come separatore decimale (12,5 == 12.5).
 * Variabili: identificatori [A-Za-z_][A-Za-z0-9_]* risolti dalla mappa `vars`
 *            (case-insensitive). Una variabile assente vale 0.
 * Funzioni: min, max, round, ceil, floor, abs (case-insensitive).
 */

const FUNCS = {
  min: Math.min,
  max: Math.max,
  round: (x) => Math.round(x),
  ceil: (x) => Math.ceil(x),
  floor: (x) => Math.floor(x),
  abs: (x) => Math.abs(x)
}

/** Converte un valore (numero o stringa con virgola/€/spazi) in Number, o NaN. */
export function toNumber(v) {
  if (typeof v === 'number') return v
  if (v == null) return NaN
  const s = String(v).replace(/[^\d,.\-]/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.')
  if (s === '' || s === '-' || s === '.') return NaN
  return Number(s)
}

function tokenize(src) {
  const tokens = []
  const re = /\s*([A-Za-z_][A-Za-z0-9_]*|\d+(?:[.,]\d+)?|[()+\-*/%,])/g
  let m
  let last = 0
  while ((m = re.exec(src)) !== null) {
    if (m.index !== last) throw new Error(`Carattere non valido in "${src}"`)
    last = re.lastIndex
    const raw = m[1]
    if (/^[A-Za-z_]/.test(raw)) tokens.push({ t: 'id', v: raw })
    else if (/^\d/.test(raw)) tokens.push({ t: 'num', v: Number(raw.replace(',', '.')) })
    else tokens.push({ t: 'op', v: raw })
  }
  if (last !== src.length) throw new Error(`Carattere non valido in "${src}"`)
  return tokens
}

/**
 * Valuta l'espressione `src` con le variabili `vars`. Ritorna un Number.
 * Lancia se la sintassi non è valida o si divide per zero.
 */
export function evalExpr(src, vars = {}) {
  const tokens = tokenize(String(src || ''))
  const lower = {}
  for (const [k, v] of Object.entries(vars)) lower[k.toLowerCase()] = v
  let i = 0
  const peek = () => tokens[i]
  const eat = (v) => {
    const tk = tokens[i]
    if (!tk || (v != null && tk.v !== v)) throw new Error(`Atteso "${v}" in "${src}"`)
    i++
    return tk
  }

  function parseExpr() { return parseSum() }
  function parseSum() {
    let left = parseProd()
    while (peek() && peek().t === 'op' && (peek().v === '+' || peek().v === '-')) {
      const op = eat().v
      const right = parseProd()
      left = op === '+' ? left + right : left - right
    }
    return left
  }
  function parseProd() {
    let left = parseUnary()
    while (peek() && peek().t === 'op' && ['*', '/', '%'].includes(peek().v)) {
      const op = eat().v
      const right = parseUnary()
      if ((op === '/' || op === '%') && right === 0) throw new Error('Divisione per zero')
      left = op === '*' ? left * right : op === '/' ? left / right : left % right
    }
    return left
  }
  function parseUnary() {
    if (peek() && peek().t === 'op' && (peek().v === '+' || peek().v === '-')) {
      const op = eat().v
      const val = parseUnary()
      return op === '-' ? -val : val
    }
    return parseAtom()
  }
  function parseAtom() {
    const tk = peek()
    if (!tk) throw new Error(`Espressione incompleta: "${src}"`)
    if (tk.t === 'num') { eat(); return tk.v }
    if (tk.v === '(') { eat('('); const val = parseExpr(); eat(')'); return val }
    if (tk.t === 'id') {
      eat()
      const name = tk.v.toLowerCase()
      if (peek() && peek().v === '(') {
        const fn = FUNCS[name]
        if (!fn) throw new Error(`Funzione sconosciuta: ${tk.v}`)
        eat('(')
        const args = []
        if (peek() && peek().v !== ')') {
          args.push(parseExpr())
          while (peek() && peek().v === ',') { eat(','); args.push(parseExpr()) }
        }
        eat(')')
        return fn(...args)
      }
      const val = Object.prototype.hasOwnProperty.call(lower, name) ? toNumber(lower[name]) : NaN
      return Number.isNaN(val) ? 0 : val
    }
    throw new Error(`Token inatteso "${tk.v}" in "${src}"`)
  }

  const result = parseExpr()
  if (i !== tokens.length) throw new Error(`Sintassi non valida: "${src}"`)
  if (!Number.isFinite(result)) throw new Error(`Risultato non valido per "${src}"`)
  return result
}

/** true se `src` è una formula sintatticamente valentabile con le variabili date (usato per validazione UI). */
export function isValidExpr(src, vars = {}) {
  try { evalExpr(src, vars); return true } catch { return false }
}
