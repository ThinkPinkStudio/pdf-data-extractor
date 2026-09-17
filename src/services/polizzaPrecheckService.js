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
  semanticScore, llmComparisonScore, decidePrecheck, topContentTerms, hasPolicyEvidence,
  rankProfilesSemantic, policyEvidenceReport,
} from './polizzaPrecheck.js'
import { stripFieldExamples } from './polizzaValidation.js'

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
/** Testi delle prime pagine dei documenti (stesso cap del bootstrap affinità del motore). */
function pageTextsOf(docs) {
  const pageTexts = []
  for (const d of docs || []) {
    for (const pg of (d.pages || []).slice(0, 2)) {
      const t = collapse(pg).slice(0, PAGE_EMBED_CHARS)
      if (t.trim()) pageTexts.push(t)
      if (pageTexts.length >= MAX_PAGES_EMBED) break
    }
    if (pageTexts.length >= MAX_PAGES_EMBED) break
  }
  return pageTexts
}

async function embedAll(settings, texts) {
  const out = []
  for (let i = 0; i < texts.length; i += 32) out.push(...await embedTexts(settings, texts.slice(i, i + 32)))
  return out
}

/**
 * Classifica i PROFILI per affinità semantica col fascicolo (bge-m3): per ogni
 * profilo, per ogni campo, la migliore affinità tra la DESCRIZIONE del campo e
 * le pagine; punteggio = media sui campi (semanticScore). Solo descrizioni
 * (senza esempi): mai label o id. Nessuna soglia: è una classifica.
 * @param {{docs:{name:string,pages:string[]}[], profiles:{id:string,name:string,fields:{description?:string,enabled?:boolean}[]}[], settings:object}} p
 * @returns {Promise<{id:string,name:string,score:number|null}[]>} vuoto se embeddings non disponibili
 */
export async function rankProfilesForDocs({ docs, profiles, settings }) {
  const list = (profiles || []).filter((p) => p && p.id && Array.isArray(p.fields))
  const pageTexts = pageTextsOf(docs)
  if (!list.length || !pageTexts.length) return []
  const pVecs = await embedAll(settings, pageTexts)
  // "COME RICONOSCERLA" (testo del profilo scritto dall'utente): è la
  // definizione del TIPO, le descrizioni dei campi parlano dei DATI (e in gran
  // parte sono comuni a tutti i profili: numero polizza, contraente,
  // indirizzo…). Se TUTTI i profili in gara ce l'hanno, la classifica si fa su
  // quello (un descrittore per profilo, punteggi confrontabili); altrimenti
  // sulle descrizioni dei campi. Mai le due scale mescolate.
  const recogOf = (p) => String(p.recognition || '').trim()
  const useRecognition = list.every((p) => recogOf(p).length > 0)
  const scored = []
  if (useRecognition) {
    const rVecs = await embedAll(settings, list.map(recogOf))
    list.forEach((p, i) => scored.push({ id: p.id, name: p.name, perFieldMax: [Math.max(...pVecs.map((v) => cosineSim(rVecs[i], v)))], signal: 'riconoscimento' }))
    return rankProfilesSemantic(scored).map((r) => ({ ...r, signal: 'riconoscimento' }))
  }
  for (const p of list) {
    const descs = p.fields.filter((f) => f && f.enabled !== false).map((f) => stripFieldExamples(String(f.description || '')).trim()).filter(Boolean)
    if (!descs.length) { scored.push({ id: p.id, name: p.name, perFieldMax: [] }); continue }
    const qVecs = await embedAll(settings, descs)
    scored.push({ id: p.id, name: p.name, perFieldMax: qVecs.map((q) => Math.max(...pVecs.map((v) => cosineSim(q, v)))) })
  }
  return rankProfilesSemantic(scored).map((r) => ({ ...r, signal: 'descrizioni dei campi' }))
}

export async function runPrecheck({ docs, fieldDefs, profile, profileName, mode, settings, allProfiles }) {
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
  let semanticRanking = null
  let jobProfileId = null
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
      // CONFRONTO tra TUTTI i profili (le loro descrizioni sono la verità): il
      // profilo del job passa se è il più affine. Se il profilo del job non è
      // più tra quelli salvati (cancellato), entra in classifica coi suoi campi
      // congelati (field_defs).
      const jobId = profile?.id || '__job__'
      // Solo profili ATTIVI in gara (enabled !== false); quello del job entra sempre.
      const pool = (allProfiles || []).filter((p) => p && p.id && p.enabled !== false)
      if (!pool.some((p) => p.id === jobId)) pool.push({ id: jobId, name: profile?.name || profileName || 'profilo del job', fields: fieldDefs || [] })
      semanticRanking = await rankProfilesForDocs({ docs, profiles: pool, settings })
      jobProfileId = jobId
      const mine = semanticRanking.find((r) => r.id === jobId)
      semantic = mine && typeof mine.score === 'number' ? mine.score : null
    } catch { semantic = null; semanticRanking = null /* embeddings giù → skipped, mai mismatch */ }
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
    semanticRanking, jobProfileId,
    contentExclude,
    // Validità "polizza vera": solo quando il testo è giudicabile (>=80 char,
    // altrimenti hasPolicyEvidence ritorna null). Flag OPT-IN dal settings
    // (default disattivo). Un guasto/ambiguità → null → skipped, mai mismatch.
    hasPolicyEvidence: normText ? hasPolicyEvidence(normText) : null,
    policyMissing: normText ? policyEvidenceReport(normText).missing : [],
    // Default ATTIVO (12/09/2026): senza polizza principale la cartella si accantona.
    requireValidPolicy: settings?.polizzaRequireValidPolicy !== false,
  })
  // SUGGERIMENTO: su ogni scarto (non solo nel modo semantico) si classificano i
  // profili attivi e, se uno è più affine di quello del job, lo si propone. Costa
  // solo embeddings (secondi); un guasto non tocca il verdetto.
  let suggestion = null
  let rankingOut = Array.isArray(semanticRanking) ? semanticRanking : null
  // Anche su ACCETTATO: la motivazione serve a vedere i falsi positivi. La
  // classifica si calcola sempre (embeddings, secondi) se ci sono profili attivi.
  if ((allProfiles || []).filter((p) => p && p.id && p.enabled !== false).length >= 1) {
    try {
      const jobId = profile?.id || '__job__'
      if (!rankingOut) {
        const pool = (allProfiles || []).filter((p) => p && p.id && p.enabled !== false)
        if (!pool.some((p) => p.id === jobId)) pool.push({ id: jobId, name: profile?.name || profileName || 'profilo del job', fields: fieldDefs || [] })
        rankingOut = await rankProfilesForDocs({ docs, profiles: pool, settings })
      }
      const best = (rankingOut || []).find((r) => typeof r.score === 'number')
      if (best && best.id !== jobId) suggestion = { id: best.id, name: best.name, score: best.score, signal: best.signal || null }
    } catch { suggestion = null }
  }
  return {
    ...decision,
    ...(keyword ? { matched: keyword.matched, missing: keyword.missing } : {}),
    ...(contentExclude ? { excludeMatched: contentExclude.matched } : {}),
    ...(rankingOut ? { ranking: rankingOut.slice(0, 5) } : {}),
    ...(suggestion ? { suggestion } : {}),
    detected,
  }
}
