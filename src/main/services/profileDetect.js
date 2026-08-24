/**
 * Abbinamento profilo ↔ fascicolo — parte PURA e testabile.
 *
 * Due segnali, in questo ordine:
 *  1. CONTENUTO: parole di contentKeywords, o in fallback matchKeywords,
 *     cercate nel testo OCR/nativo (stesso matching del pre-check);
 *  2. PERCORSO: matchKeywords (o il nome del profilo) come sottostringa
 *     nel label/cartella — comportamento storico del bulk.
 *
 * Nessuna chiamata LLM: solo keywordVerdict. Usato dal pre-filtro bulk
 * (`/api/polizza/bulk/detect`) e dai test del campione Cedam/Fabbricati.
 */

import {
  parseContentKeywords, normalizeForPrecheck, KEYWORD_MIN_RATIO,
} from './polizzaPrecheck.js'

/**
 * Espansioni type-blind dei fusti corti usati in matchKeywords / nome profilo.
 * "med" NON è sottostringa di "CEDAM" né di "SANITARI": senza queste
 * espansioni il fascicolo Cedam (RISCHI SANITARI PRIVATI) non matcherebbe
 * RC PROF MED V2. Non classifica il TIPO di file: amplia solo il lessico
 * del profilo. Il rapporto si calcola sulle keyword PRIMARIE (uno stem
 * contato una volta), così le espansioni non diluiscono la soglia.
 */
const STEM_EXPAND = {
  med: ['medico', 'medici', 'medicina', 'sanitari', 'sanitaria', 'sanitario'],
  prof: ['professionale', 'professionisti'],
  rct: ['responsabilita civile'],
  rco: ['prestatori'],
  rcp: ['professionale'],
}

function variantsOf(keyword) {
  const n = normalizeForPrecheck(keyword)
  return n ? [keyword, ...(STEM_EXPAND[n] || [])] : [keyword]
}

/**
 * Verdetto contenuto: un fusto matcha se LUI o una sua espansione compare
 * nel testo. `matched` elenca le keyword primarie colpite; `variants` le
 * forme trovate nel testo (per il log e per scartare i match di 3 lettere
 * tipo "med" in "medesimo").
 */
export function contentKeywordVerdict(profile, normText) {
  const resolved = resolveContentKeywords(profile)
  const kws = resolved.keywords
  if (!kws.length) {
    return { matched: [], missing: [], ratio: 0, source: resolved.source, variants: [] }
  }
  if (!normText) {
    return { matched: [], missing: kws, ratio: 0, source: resolved.source, variants: [] }
  }
  const matched = [], missing = [], variants = []
  for (const k of kws) {
    const hit = variantsOf(k).find((x) => normText.includes(normalizeForPrecheck(x)))
    if (hit) { matched.push(k); variants.push(hit) }
    else missing.push(k)
  }
  return {
    matched, missing,
    ratio: matched.length / kws.length,
    source: resolved.source,
    variants,
  }
}

/** Un solo fusto di 3 lettere ("med"⊂"medesimo") non assegna un profilo. */
export function isSignificantContent(verdict, minRatio = KEYWORD_MIN_RATIO) {
  if (!verdict || verdict.ratio < minRatio) return false
  const forms = (verdict.variants && verdict.variants.length) ? verdict.variants : (verdict.matched || [])
  return forms.some((k) => normalizeForPrecheck(k).length >= 4) || (verdict.matched || []).length >= 2
}

/** Parole di CONTENUTO: contentKeywords se presenti, altrimenti matchKeywords
 *  più i token del NOME profilo (es. "RC PROF MED V2" → prof, med). Il nome
 *  è un segnale type-blind: non classifica il file, cerca le stesse parole
 *  nel testo ( "PROF" trova "professionale" in una RC sanitaria). */
export function resolveContentKeywords(profile) {
  const fromContent = parseContentKeywords(profile?.contentKeywords)
  if (fromContent.length) return { keywords: fromContent, source: 'contentKeywords' }
  const fromMatch = parseContentKeywords(profile?.matchKeywords)
  const nameRaw = String(profile?.name || '').replace(/\bV\d+\b/gi, '').replace(/[\s_./-]+/g, ',')
  const fromName = parseContentKeywords(nameRaw)
  const merged = []
  const seen = new Set()
  for (const k of [...fromMatch, ...fromName]) {
    const n = k.toLowerCase()
    if (seen.has(n)) continue
    seen.add(n)
    merged.push(k)
  }
  if (merged.length) return { keywords: merged, source: fromMatch.length ? 'matchKeywords' : 'name' }
  return { keywords: [], source: null }
}

/** Parole di PERCORSO: matchKeywords esplicite, altrimenti il nome del profilo. */
export function profilePathKeywords(profile) {
  const kw = parseContentKeywords(profile?.matchKeywords)
  if (kw.length) return kw
  return parseContentKeywords(profile?.name)
}

function pathHit(profile, label) {
  const path = String(label || '').toLowerCase()
  if (!path) return false
  return profilePathKeywords(profile).some((k) => path.includes(String(k).toLowerCase()))
}

/**
 * Sceglie il profilo di un dossier.
 *
 * @param {object} p
 * @param {string} p.label         percorso/etichetta del dossier
 * @param {string} [p.contentText] testo nativo/OCR (opzionale)
 * @param {Array}  p.profiles      profili caricati
 * @param {number} [p.minRatio]    soglia keyword (default KEYWORD_MIN_RATIO)
 * @returns {{ profileId: string, via: 'content'|'path'|null, matched: string[], missing: string[], score: number|null, source: string|null }}
 */
export function detectProfileForDossier({ label, contentText, profiles, minRatio = KEYWORD_MIN_RATIO } = {}) {
  const list = Array.isArray(profiles) ? profiles : []
  const empty = { profileId: '', via: null, matched: [], missing: [], score: null, source: null }
  if (!list.length) return empty

  const normContent = contentText ? normalizeForPrecheck(contentText) : ''
  const scored = list.map((p) => {
    const content = contentKeywordVerdict(p, normContent)
    return {
      p,
      pathHit: pathHit(p, label),
      content,
      contentSource: content.source,
    }
  })

  const contentWinners = scored
    .filter((s) => isSignificantContent(s.content, minRatio))
    .sort((a, b) => b.content.ratio - a.content.ratio
      || b.content.matched.length - a.content.matched.length
      || String(a.p.name || '').localeCompare(String(b.p.name || '')))

  if (contentWinners.length && normContent) {
    const best = contentWinners[0]
    const pathHits = scored.filter((s) => s.pathHit)
    // Contenuto DEBOLE (< 0.5) che contraddice un match di percorso più
    // specifico: vince il percorso (evita che "med" in "medesimo" riassegni
    // un fascicolo incendio al profilo sanitario).
    if (best.content.ratio < 0.5 && !best.pathHit && pathHits.length && pathHits[0].p.id !== best.p.id) {
      const ph = pathHits[0]
      return {
        profileId: ph.p.id,
        via: 'path',
        matched: ph.content.matched,
        missing: ph.content.missing,
        score: ph.content.ratio || null,
        source: 'matchKeywords',
      }
    }
    return {
      profileId: best.p.id,
      via: 'content',
      matched: best.content.matched,
      missing: best.content.missing,
      score: best.content.ratio,
      source: best.contentSource,
    }
  }

  const ph = scored.find((s) => s.pathHit)
  if (ph) {
    return {
      profileId: ph.p.id,
      via: 'path',
      matched: [],
      missing: [],
      score: null,
      source: 'matchKeywords',
    }
  }
  return empty
}
