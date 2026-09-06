/**
 * Pre-controllo di pertinenza profilo↔fascicolo — ORCHESTRATORE (impuro).
 *
 * Calcola gli input dei tre metodi (testo, embeddings, LLM) e delega il
 * VERDETTO alla parte pura (polizzaPrecheck.js). Regola ferrea: questo
 * controllo non deve MAI far fallire un job — ogni guasto infrastrutturale
 * (Ollama giù, embeddings assenti) produce 'skipped', mai 'mismatch'.
 */

import { embedTexts } from './vectorIndexService.js'
import { streamChatWithProvider } from './llmService.js'
import {
  normalizeForPrecheck, parseContentKeywords, keywordVerdict, contentExcludeVerdict, cosineSim,
  semanticScore, llmComparisonScore, decidePrecheck, topContentTerms,
} from './polizzaPrecheck.js'

// Cap dei costi: il pre-check deve costare SECONDI, non minuti.
const MAX_PAGES_EMBED = 40      // prime 2 pagine per documento, fino a 40 testi
const PAGE_EMBED_CHARS = 2000   // stesso cap del bootstrap affinità del motore
const LLM_CTX_CHARS = 6000      // prime pagine dei primi documenti

const collapse = (p) => String(p || '').split('\n').map((l) => l.replace(/\s{2,}/g, ' ').trim()).join('\n')

/**
 * @param {object} p
 * @param {{name:string,pages:string[]}[]} p.docs   documenti post-OCR
 * @param {{id:string,label:string,description?:string}[]} p.fieldDefs campi congelati del job
 * @param {object|null} p.profile   profilo LIVE (per contentKeywords/nome) — può essere null se cancellato
 * @param {string} p.profileName    nome del profilo (persistito nel job)
 * @param {'keywords'|'semantic'|'llm'} p.mode
 * @param {object} p.settings
 * @returns {Promise<{verdict:string, mode:string, score:number|null, threshold:number|null, reason:string,
 *                    matched?:string[], missing?:string[], detected:{type:string|null, keywords:string[]}}>}
 */
export async function runPrecheck({ docs, fieldDefs, profile, profileName, mode, settings }) {
  // Fallback su matchKeywords: profili creati prima dell'introduzione di
  // contentKeywords portano solo le keyword di riconoscimento del NOME cartella
  // (es. RC PROF MED V2 → "MEDICO, medico, med"): senza questo fallback il
  // pre-check di contenuto vede zero keyword e degrada a semantic. Nota:
  // parseContentKeywords ritorna [] (truthy) anche su stringa vuota, quindi il
  // fallback va deciso sulla LUNGHEZZA, non con ||.
  const contentKws = parseContentKeywords(profile?.contentKeywords)
  const kws = contentKws.length ? contentKws : parseContentKeywords(profile?.matchKeywords)
  // Parole del CONTENUTO da evitare: indipendenti dallo switch, bloccano sempre.
  const contentExcludeKws = parseContentKeywords(profile?.contentExcludeKeywords)
  const normText = normalizeForPrecheck((docs || []).map((d) => (d.pages || []).join('\n')).join('\n'))

  let keyword = null
  let semantic = null
  let llm = null
  let contentExclude = null
  let detected = { type: null, keywords: topContentTerms(normText) }

  // Modalità effettiva: keyword di contenuto presenti → SEMPRE 'keywords' (anche
  // con switch 'off': le parole esplicite del profilo vincono). Degrada a
  // 'semantic' SOLO quando lo switch è 'keywords' ma il profilo non ha keyword.
  const effective = kws.length
    ? 'keywords'
    : (mode === 'keywords') ? 'semantic' : mode

  if (contentExcludeKws.length) {
    contentExclude = normText ? contentExcludeVerdict(contentExcludeKws, normText) : null
  }

  if (effective === 'keywords') {
    keyword = normText ? keywordVerdict(kws, normText) : null
  } else if (effective === 'semantic') {
    try {
      const fields = (fieldDefs || []).filter((f) => f?.label)
      const pageTexts = []
      for (const d of docs || []) {
        for (const pg of (d.pages || []).slice(0, 2)) {
          const t = collapse(pg).slice(0, PAGE_EMBED_CHARS)
          if (t.trim()) pageTexts.push(t)
          if (pageTexts.length >= MAX_PAGES_EMBED) break
        }
        if (pageTexts.length >= MAX_PAGES_EMBED) break
      }
      if (fields.length && pageTexts.length) {
        const qVecs = await embedTexts(settings, fields.map((f) => `${f.label}. ${f.description || ''}`))
        const pVecs = []
        for (let i = 0; i < pageTexts.length; i += 32) {
          pVecs.push(...await embedTexts(settings, pageTexts.slice(i, i + 32)))
        }
        semantic = semanticScore(qVecs.map((q) => Math.max(...pVecs.map((v) => cosineSim(q, v)))))
      }
    } catch { semantic = null /* embeddings giù → skipped, mai mismatch */ }
  } else if (effective === 'llm') {
    try {
      let ctx = ''
      for (const d of (docs || []).slice(0, 3)) {
        for (const pg of (d.pages || []).slice(0, 2)) {
          if (ctx.length >= LLM_CTX_CHARS) break
          ctx += `\n[${d.name}]\n${collapse(pg).slice(0, LLM_CTX_CHARS - ctx.length)}`
        }
      }
      if (ctx.trim()) {
        const messages = [
          { role: 'system', content: 'Sei un classificatore di documenti assicurativi italiani. Rispondi SOLO con un oggetto JSON, zero testo extra, zero markdown.' },
          { role: 'user', content: `Di che tipo di polizza/documento si tratta? Rispondi SOLO JSON: {"tipo":"descrizione breve del ramo/tipo (es. responsabilità civile terzi e prestatori)","parole_chiave":["5 parole chiave del contenuto"]}\n\nESTRATTI:\n${ctx}` },
        ]
        let raw = ''
        for await (const chunk of streamChatWithProvider(settings, messages)) raw += chunk
        const m = raw.match(/\{[\s\S]*\}/)
        if (m) {
          const parsed = JSON.parse(m[0])
          detected = {
            type: typeof parsed?.tipo === 'string' ? parsed.tipo.slice(0, 120) : null,
            keywords: Array.isArray(parsed?.parole_chiave) ? parsed.parole_chiave.map((k) => String(k).slice(0, 40)).slice(0, 8) : [],
          }
          const profileTerms = [profile?.name || profileName || '', profile?.contentKeywords || '', ...(fieldDefs || []).map((f) => f?.label || '')]
          llm = llmComparisonScore(detected, profileTerms)
        }
      }
    } catch { llm = null /* modello giù/muto → skipped, mai mismatch */ }
  }

  const decision = decidePrecheck({
    mode,
    hasProfile: true, // il chiamante (worker) passa di qui solo con profile_id sul job
    hasContentKeywords: kws.length > 0,
    hasContentExclude: contentExcludeKws.length > 0,
    keyword, semantic, llm,
    contentExclude,
  })
  return {
    ...decision,
    ...(keyword ? { matched: keyword.matched, missing: keyword.missing } : {}),
    ...(contentExclude ? { excludeMatched: contentExclude.matched } : {}),
    detected,
  }
}
