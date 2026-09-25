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
  rankProfilesSemantic, policyEvidenceReport, effectivePrecheckMode, degradeWithoutRecognition,
} from './polizzaPrecheck.js'
import { cutUseful, OPERATIVITA_MAX_PAGE_CHARS, namesCoverage } from './polizzaOperativita.js'
import { stripFieldExamples } from './polizzaValidation.js'
import { usefulLength } from './ocrLayout.js'
import {
  selectOperativitaPages, buildOperativitaPrompt, operativitaSchema, parseOperativitaAnswer,
  verifyOperativitaEvidence, decideOperativita, combineOperativitaBatches, recognitionCoverName,
  buildContrattoPrompt, contrattoSchema, parseContrattoAnswer,
  OPERATIVITA_MAX_PAGES, OPERATIVITA_MAX_PAGES_PER_DOC, OPERATIVITA_MAX_BATCHES,
} from './polizzaOperativita.js'
import { callOllamaRolling, ctxCap, computeSafeContextBudget, withPairs } from './polizzaService.js'

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

/** Testo di riconoscimento del profilo («Come riconoscerla»), vuoto se assente. */
export function recognitionOf(profile) {
  return String(profile?.recognition || '').trim()
}

/** Parole del contenuto «da evitare» del profilo trovate nel testo dei documenti (per l'operatività del profilo Automatico). */
export function contentExcludeMatched(profile, docs) {
  const kws = parseContentKeywords(profile?.contentExcludeKeywords)
  if (!kws.length) return []
  const normText = normalizeForPrecheck((docs || []).map((d) => (d.pages || []).join('\n')).join('\n'))
  return normText ? contentExcludeVerdict(kws, normText).matched : []
}

/**
 * CONTROLLO DI OPERATIVITÀ (vedi polizzaOperativita.js): la copertura definita
 * in «Come riconoscerla» è davvero acquistata nel fascicolo?
 *  1. embedding (bge-m3) del testo di riconoscimento e delle pagine PIATTE;
 *  2. pagine scelte per affinità (prime pagine dei documenti in testa) fino al
 *     budget del contesto (ctxCap, stesso calcolo dei batch a stadi);
 *  3. al modello va la GRIGLIA SPAZIALE (caselle e colonne premio restano
 *     incolonnate), marcatori [Documento N · pag. P], mai il nome file;
 *  4. risposta vincolata da JSON Schema, prova verificata nel testo, decisione.
 * Ritorna null se il profilo non ha «Come riconoscerla». Un guasto (Ollama,
 * embeddings) NON lancia: torna come verdetto 'review' con la ragione.
 * @param {{docs:{name:string,pages:string[]}[], spatialDocs?:{pages:string[]}[], profile:object, profiles?:object[], settings:object, excludeMatched?:string[], diag?:string[]}} p
 *   profiles: gli altri profili in gara — servono SOLO per le parole distintive
 *   di «Come riconoscerla» (frequenza inversa sulle teste).
 */
export async function runOperativita({ docs, spatialDocs, profile, profiles = [], settings, excludeMatched = [], diag = null, maxBatches = OPERATIVITA_MAX_BATCHES }) {
  const recognition = recognitionOf(profile)
  if (!recognition) return null
  const contentKeywords = parseContentKeywords(profile?.contentKeywords)
  const contentExcludeKeywords = parseContentKeywords(profile?.contentExcludeKeywords)
  const log = (m) => { if (Array.isArray(diag)) diag.push(m) }
  const pool = [...(profiles || []).filter((p) => p && p.id && p.id !== profile?.id), profile]
  const lexTokens = recognitionCoverName(pool, profile?.id)
  log(`Operatività «${profile?.name || ''}»: nome della copertura da «Come riconoscerla»: ${lexTokens.length ? `«${lexTokens.join(' ')}»` : 'non determinabile (controlli lessicali non applicabili)'}`)
  try {
    // Candidati: ogni pagina con testo, ordinale del documento = posizione nel fascicolo.
    const candidates = []
    ;(docs || []).forEach((d, i) => {
      const flatPages = d?.pages || []
      const gridPages = spatialDocs?.[i]?.pages || []
      // Markdown in un BLOB unico (pdf-inspector / Docling a pagina singola) con
      // la griglia su N pagine: si va per pagine di GRIGLIA (piatto = griglia
      // collassata), altrimenti si vedeva solo la pagina 1.
      const byGrid = gridPages.length > flatPages.length
      const nPages = byGrid ? gridPages.length : flatPages.length
      let perDoc = 0
      for (let p = 0; p < nPages; p++) {
        if (candidates.length >= OPERATIVITA_MAX_PAGES || perDoc >= OPERATIVITA_MAX_PAGES_PER_DOC) break
        const grid = String(gridPages[p] || '')
        const flat = byGrid ? collapse(grid) : collapse(flatPages[p])
        if (!flat.trim()) continue
        // STESSO testo dei prompt di estrazione: griglia spaziale + coppie
        // etichetta→valore lette dal layout (withPairs: suggerimento di
        // lettura, mai una verità imposta — REGOLE 1c).
        const full = grid.trim() ? withPairs(grid) : flat
        // Pagine LUNGHE (oltre il taglio per pagina): spezzate in parti, tutte
        // candidate — il taglio teneva solo l'inizio e una riga di premio in
        // fondo a una scheda fitta non arrivava mai al modello.
        const parts = []
        let rest = full
        while (usefulLength(rest) > OPERATIVITA_MAX_PAGE_CHARS && parts.length < 3) {
          const head = cutUseful(rest, OPERATIVITA_MAX_PAGE_CHARS)
          if (!head.trim() || head.length >= rest.length) break
          parts.push(head); rest = rest.slice(head.length)
        }
        parts.push(rest)
        parts.forEach((text, k) => {
          if (!text.trim()) return
          candidates.push({ ord: i + 1, page: p + 1, part: parts.length > 1 ? k + 1 : null, flat: collapse(text), text, score: null })
        })
        perDoc++
      }
    })
    if (!candidates.length) return decideOperativita({ error: 'nessuna pagina con testo' })
    const vecs = await embedAll(settings, [recognition, ...candidates.map((c) => c.flat.slice(0, PAGE_EMBED_CHARS))])
    const rVec = vecs[0]
    candidates.forEach((c, i) => { c.score = cosineSim(rVec, vecs[i + 1]) })
    // Budget di testo: contesto massimo meno prompt (senza pagine) e margine.
    const probe = buildOperativitaPrompt({ recognition, contentKeywords, contentExcludeKeywords, blocks: [] })
    const budgetChars = computeSafeContextBudget(ctxCap(settings), { systemChars: probe.system.length, userChars: probe.user.length })
    // BATCH SUCCESSIVI per affinità (copertura progressiva del fascicolo): il
    // primo batch porta le prime pagine dei documenti e le più affini; se non
    // arriva una prova di operatività si passa alle pagine seguenti, fino a
    // maxBatches. Una chiamata costa secondi (prompt ≤ 8192): meglio leggere
    // di più che scartare una polizza vera per non aver visto la sua scheda.
    let remaining = candidates
    const results = []
    const pagesSent = []
    let needContract = false
    for (let b = 0; b < maxBatches && remaining.length; b++) {
      const blocks = selectOperativitaPages(remaining, { budgetChars, lexTokens })
      if (!blocks.length) break
      const taken = new Set(blocks.map((x) => `${x.ord}:${x.page}`))
      remaining = remaining.filter((c) => !taken.has(`${c.ord}:${c.page}`))
      const { system, user } = buildOperativitaPrompt({ recognition, contentKeywords, contentExcludeKeywords, blocks })
      log(`Operatività «${profile?.name || ''}» batch ${b + 1}: ${blocks.length} pagine (restano ${remaining.length} su ${candidates.length}; budget ${budgetChars} char utili): ${blocks.map((x) => `D${x.ord}p${x.page}${x.part ? `/${x.part}` : ''}${x.cut ? '*' : ''}${x.structural ? '‡' : x.lex ? '†' : ''}${x.amount ? '€' : ''} ${(x.score ?? 0).toFixed(2)}`).join(', ')}${blocks.some((x) => x.lex) ? ' (‡ = riga copertura+importo, † = nomina la copertura, € = con importi)' : ''}`)
      const raw = await callOllamaRolling(settings, system, user, {
        numCtx: ctxCap(settings), timeoutMs: 180000, numPredict: 400, format: operativitaSchema(), fields: [], shape: 'staged', diag,
      })
      const answer = parseOperativitaAnswer(raw)
      const evidence = answer ? verifyOperativitaEvidence(answer, blocks, { lexTokens }) : null
      const decision = decideOperativita({ answer, evidence, excludeMatched })
      log(`Operatività «${profile?.name || ''}» batch ${b + 1}: ${decision.verdict} — ${decision.reason}${answer?.evidenza ? ` · prova: «${answer.evidenza.slice(0, 120)}» (${evidence?.reason || ''})` : ''}`)
      // Dopo un «operante»: c'è il CONTRATTO tra le pagine lette (domanda a
      // parte, breve)? Con sole quietanze si continua a cercare il frontespizio
      // nei batch successivi; se nessun batch lo mostra → Accantonata.
      if (decision.verdict === 'ok') needContract = true
      if (needContract) {
        const cq = buildContrattoPrompt({ blocks })
        const rawC = await callOllamaRolling(settings, cq.system, cq.user, { numCtx: ctxCap(settings), timeoutMs: 180000, numPredict: 200, format: contrattoSchema(), fields: [], shape: 'staged', diag })
        const ca = parseContrattoAnswer(rawC)
        decision.contratto = ca?.contratto || 'non determinabile'
        log(`Operatività «${profile?.name || ''}» batch ${b + 1}: contratto ${decision.contratto}${ca?.motivo ? ` — ${ca.motivo.slice(0, 140)}` : ''}`)
      }
      results.push(decision)
      pagesSent.push(...blocks.map((x) => ({ ord: x.ord, page: x.page, score: x.score, batch: b + 1 })))
      // Operante già ottenuto: ci si ferma appena il CONTRATTO è stato visto
      // (anche in un batch successivo, il cui esito non conta più: BOIARDO
      // leggeva 6 batch dopo l'«operante» del primo).
      if (needContract && results.some((r) => r.contratto === 'presente')) break
      // Operante + parola da evitare = contraddizione già certa: inutile leggere oltre.
      if (decision.verdict === 'review' && answer?.esito === 'operante' && excludeMatched.length) break
    }
    const unreadNamed = remaining.filter((c) => namesCoverage(c.flat || c.text, lexTokens) === true).length
    const final = combineOperativitaBatches(results, { unreadNamed })
    if (results.length > 1) log(`Operatività «${profile?.name || ''}»: esito complessivo su ${results.length} batch → ${final.verdict}${final.verdict === 'review' && /contraddittori/.test(final.reason) ? ' (esiti contraddittori)' : ''}`)
    const src = final.documento ? docs?.[final.documento - 1] : null
    return {
      ...final,
      docName: src?.name || null,
      pagesSent,
      profileId: profile?.id || null, profileName: profile?.name || null,
    }
  } catch (err) {
    log(`Operatività «${profile?.name || ''}»: non eseguibile (${err?.message || err})`)
    return { ...decideOperativita({ error: err?.message || String(err) }), profileId: profile?.id || null, profileName: profile?.name || null }
  }
}

/**
 * PROFILO SUGGERITO per operatività: se la copertura del profilo del job non è
 * operante (o è dubbia), lo stesso controllo gira sugli altri profili ATTIVI
 * con «Come riconoscerla», nell'ordine della classifica semantica, fino a
 * `max` tentativi: il primo operante con prova è il suggerimento. Il profilo
 * del job NON cambia da solo.
 */
export async function suggestOperativeProfile({ docs, spatialDocs, profiles, ranking, excludeId, settings, diag = null, max = 2 }) {
  const withRecog = (profiles || []).filter((p) => p && p.id && p.id !== excludeId && p.enabled !== false && recognitionOf(p))
  if (!withRecog.length) return null
  const order = new Map((ranking || []).map((r, i) => [r.id, i]))
  const sorted = [...withRecog].sort((a, b) => (order.has(a.id) ? order.get(a.id) : 1e9) - (order.has(b.id) ? order.get(b.id) : 1e9))
  const tried = []
  for (const p of sorted.slice(0, max)) {
    // Meno batch per i profili alternativi: il suggerimento è un aiuto, non un secondo controllo pieno.
    const r = await runOperativita({ docs, spatialDocs, profile: p, profiles, settings, diag, maxBatches: Math.max(1, Math.ceil(OPERATIVITA_MAX_BATCHES / 2)) })
    tried.push({ id: p.id, name: p.name, verdict: r?.verdict || 'review', reason: r?.reason || '' })
    if (r && r.verdict === 'ok') return { id: p.id, name: p.name, score: null, signal: 'operatività', operativita: r, tried }
  }
  return { id: null, name: null, tried }
}

export async function runPrecheck({ docs, spatialDocs, fieldDefs, profile, profileName, mode, settings, allProfiles, operativita: operativitaPre = null, operativitaTried: triedPre = null, diag = null }) {
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

  // Modalità effettiva: STESSA funzione della decisione (effectivePrecheckMode).
  // Prima qui bastava una parola del contenuto per forzare 'keywords' mentre la
  // decisione restava 'semantic' e, senza classifica, rispondeva «accettato
  // senza controllo». Le parole si valutano comunque (informazione nel log).
  const effective = effectivePrecheckMode(mode, kws.length > 0)
  const recognition = recognitionOf(profile)
  const operative = !!recognition && (mode || 'off') !== 'off'

  if (contentExcludeKws.length) {
    contentExclude = normText ? contentExcludeVerdict(contentExcludeKws, normText) : null
  }
  if (kws.length && normText) keyword = keywordVerdict(kws, normText)

  // Validità «polizza vera» (regola economica, decide PRIMA dell'operatività
  // in decidePrecheck): se la cartella verrà accantonata, l'operatività non si
  // calcola nemmeno (fino a 6 chiamate buttate).
  const policyEv = normText ? hasPolicyEvidence(normText) : null
  const willSetAside = policyEv === false && settings?.polizzaRequireValidPolicy !== false

  // OPERATIVITÀ: il controllo vero quando il profilo dice come riconoscere la
  // copertura. Un risultato precalcolato (profilo Automatico del worker) evita
  // una seconda chiamata identica.
  let operativita = null
  if (operative && !willSetAside) {
    operativita = operativitaPre || await runOperativita({
      docs, spatialDocs, profile, profiles: allProfiles, settings, diag,
      excludeMatched: contentExclude?.matched || [],
    })
  }

  if (operative) {
    // I metodi storici non servono: la classifica (per il suggerimento) si calcola sotto.
  } else if (effective === 'keywords') {
    // keyword già valutate sopra
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

  let decision = decidePrecheck({
    mode,
    hasProfile: true, // il chiamante (worker) passa di qui solo con profile_id sul job
    hasContentKeywords: kws.length > 0,
    hasContentExclude: contentExcludeKws.length > 0,
    hasRecognition: !!recognition,
    operativita,
    keyword, semantic, llm,
    semanticRanking, jobProfileId,
    contentExclude,
    // Validità "polizza vera": solo quando il testo è giudicabile (>=80 char,
    // altrimenti hasPolicyEvidence ritorna null). Flag OPT-IN dal settings
    // (default disattivo). Un guasto/ambiguità → null → skipped, mai mismatch.
    hasPolicyEvidence: policyEv,
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
  // Con l'operatività un suggerimento vale solo se l'ALTRO profilo risulta
  // OPERANTE con prova (stesso controllo sui primi 2 della classifica): la
  // sola affinità delle descrizioni non basta più a proporre un profilo.
  let operativitaTried = Array.isArray(triedPre) && triedPre.length ? triedPre : null
  if (operative && decision.verdict !== 'ok' && !willSetAside) {
    try {
      // Profili già provati dal chiamante (percorso Automatico): non si
      // rifanno; un loro «operante» è già il suggerimento.
      const already = new Set((triedPre || []).map((t) => t.id))
      const alreadyOk = (triedPre || []).find((t) => t.verdict === 'ok')
      const sugg = alreadyOk
        ? { id: alreadyOk.id, name: alreadyOk.name, tried: [] }
        : await suggestOperativeProfile({
          docs, spatialDocs, settings, diag, ranking: rankingOut,
          profiles: (allProfiles || []).filter((p) => p && !already.has(p.id)), excludeId: profile?.id || '__job__',
        })
      operativitaTried = [...(triedPre || []), ...(sugg?.tried || [])]
      suggestion = sugg && sugg.id ? { id: sugg.id, name: sugg.name, score: null, signal: 'operatività', operativita: sugg.operativita } : null
    } catch { suggestion = null }
  } else if (operative) {
    suggestion = null // copertura operante con prova: nessun profilo alternativo da proporre
  }
  // Profilo senza «Come riconoscerla»: 'ok' con un profilo più affine, o
  // 'skipped', diventano «da verificare» (mai accettato in silenzio).
  decision = degradeWithoutRecognition(decision, { hasRecognition: !!recognition, mode, suggestion })
  return {
    ...decision,
    ...(operativitaTried ? { operativitaTried } : {}),
    ...(keyword ? { matched: keyword.matched, missing: keyword.missing } : {}),
    ...(contentExclude ? { excludeMatched: contentExclude.matched } : {}),
    ...(rankingOut ? { ranking: rankingOut.slice(0, 5) } : {}),
    ...(suggestion ? { suggestion } : {}),
    detected,
  }
}
