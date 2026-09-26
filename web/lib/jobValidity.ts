// «NON VALIDO» — fascicolo senza polizza. UNA regola per worker, store, route
// e interfaccia (pagina Elaborazioni): nessuna dipendenza, così si importa da
// ovunque e si testa da sola (test/uiJobState.test.mjs).
//
// Regola dell'utente del 26/09/2026, testuale: «SE NON HAI UNA POLIZZA NON
// ESTRAI! SENZA UNA POLIZZA È SEMPRE NON VALIDO». Caso che l'ha scatenata:
// ALZAIA NAVIGLIO PAVESE 101 Tutela legale DAS, un solo file, una QUIETANZA di
// rinnovo: era «Da verificare», forzabile, ed è stata estratta.
// Un Non valido è 'mismatch' nel DB (bloccato) ma, a differenza di «Non
// pertinente» e «Scartato», NON si forza: niente «Procedi comunque», niente ▶,
// niente riuso dei risultati; resta solo «Riabbina» (che rifà il controllo).
// Lo decide SOLO il modello (esito «assente» della domanda sul contratto,
// decideContract): i vecchi «Accantonato — …» (fino al 26/09) venivano anche
// dalla regex «polizza vera», con falsi negativi veri (LUCCA AmTrust
// «Certificato N°»), quindi restano FORZABILI: «Procedi comunque» passa dalla
// guardia del worker, che chiede al modello prima di estrarre.

/** Esito della domanda sulla presenza della polizza (decideContract, src/services/polizzaOperativita.js). */
export interface PolizzaCheck {
  esito: 'presente' | 'assente' | 'non determinabile' | 'non verificata' | string
  documento?: number | null
  pagina?: number | null
  motivo?: string
  reason?: string
  asked?: number | null
  error?: boolean
}

/** Prefisso del testo errore di un job senza polizza. */
export const NOT_VALID_PREFIX = 'Non valido'
/** Prefisso dei vecchi job «Accantonato» (forzabili: vedi sopra). */
export const LEGACY_SET_ASIDE_PREFIX = 'Accantonato'

/** Messaggio di rifiuto (409) di ogni azione che forzerebbe l'estrazione. */
export const NOT_VALID_REFUSAL = 'Fascicolo non valido: il modello non ha trovato una polizza tra i documenti letti, e senza polizza non si estrae (non si forza). Riabbina rifà il controllo sugli stessi documenti; se la polizza manca, ricarica la cartella con la polizza'

export function hasNotValidPrefix(error: string | null | undefined): boolean {
  return String(error || '').startsWith(NOT_VALID_PREFIX)
}

/** Quel che serve di un job (riga del DB o snapshot dell'interfaccia). */
export interface JobLike { status?: string | null; error?: string | null; precheck?: unknown }

type PrecheckLike = { notValid?: unknown; setAside?: unknown; override?: unknown; polizza?: { esito?: unknown } | null }
const precheckOf = (job: JobLike): PrecheckLike => (job.precheck && typeof job.precheck === 'object' ? job.precheck : {}) as PrecheckLike

/**
 * Il job è NON VALIDO (nessuna polizza)? Solo in stato 'mismatch' (bloccato):
 * un job rimesso in coda con Riabbina non lo è più. Basta uno dei segnali:
 * precheck.notValid, l'esito «assente» della polizza, o il prefisso «Non
 * valido» del testo errore.
 */
export function isNotValidJob(job: JobLike | null | undefined): boolean {
  if (!job || job.status !== 'mismatch') return false
  const pc = precheckOf(job)
  return !!pc.notValid || pc.polizza?.esito === 'assente' || hasNotValidPrefix(job.error)
}

/** Vecchio «Accantonato» (prima del 26/09): bloccato ma forzabile, la polizza la verifica il modello. */
export function isLegacySetAside(job: JobLike | null | undefined): boolean {
  if (!job || job.status !== 'mismatch' || isNotValidJob(job)) return false
  return !!precheckOf(job).setAside || String(job.error || '').startsWith(LEGACY_SET_ASIDE_PREFIX)
}

/**
 * Valori estratti FORZANDO (Procedi comunque) senza una polizza vista dal
 * modello: non si copiano in un altro job (riuso), sarebbe estendere a un
 * fascicolo la decisione presa dall'operatore su un altro (l'ALZAIA 101
 * estratta prima del 26/09 è un job così).
 */
export function forcedWithoutPolicy(job: JobLike | null | undefined): boolean {
  if (!job) return false
  const pc = precheckOf(job)
  return !!pc.override && pc.polizza?.esito !== 'presente'
}

/** Rifiuto per le route (proceed / extract / reuse / bulk): null se l'azione è ammessa. */
export function notValidRefusal(job: JobLike | null | undefined): { error: string; code: 'not-valid' } | null {
  return isNotValidJob(job) ? { error: NOT_VALID_REFUSAL, code: 'not-valid' } : null
}

/** Testo errore scritto dal worker per un Non valido (la pillola lo riconosce dal prefisso). */
export function notValidError(reason: string, docNames: string): string {
  return `${NOT_VALID_PREFIX} — ${reason}. Documenti letti: ${docNames}. Senza una polizza non si estrae e non si forza: "Riabbina" rifà il controllo sugli stessi documenti; se la polizza manca, ricarica la cartella con la polizza.`
}

/**
 * GUARDIA prima dell'estrazione (worker, ensurePolicy): cosa fare con l'esito
 * della polizza. Da soli si estrae SOLO con una polizza vista dal modello
 * («presente»); «assente» è Non valido, sempre. «non determinabile» / «non
 * verificata» (senza guasto) si estraggono solo se l'operatore ha premuto
 * «Procedi comunque» SAPENDO quell'esito (`informed`: era già nel job prima
 * della run, quindi nel perché che ha letto); se l'esito arriva solo ora, ci si
 * ferma in «Da verificare» col perché e il prossimo Procedi comunque decide.
 * Un guasto (`error`) ferma sempre: prima si rifà il controllo.
 */
export type PolicyGate = 'extract' | 'notValid' | 'review'
export function policyGate(pol: PolizzaCheck | null | undefined, { override = false, informed = false }: { override?: boolean; informed?: boolean } = {}): PolicyGate {
  if (!pol || !pol.esito) return 'review'
  if (pol.esito === 'presente' && !pol.error) return 'extract'
  if (pol.esito === 'assente') return 'notValid'
  if (!pol.error && override && informed) return 'extract'
  return 'review'
}

/** « · polizza: presente — Documento N pag. P: motivo» per la motivazione (colonna Pertinenza dell'export). */
export function polizzaLine(pol: PolizzaCheck | null | undefined): string {
  if (!pol || !pol.esito) return ''
  const where = pol.documento ? ` — Documento ${pol.documento}${pol.pagina ? ` pag. ${pol.pagina}` : ''}` : ''
  const why = pol.motivo ? `: ${String(pol.motivo).slice(0, 200)}` : pol.esito !== 'presente' && pol.reason ? `: ${String(pol.reason).slice(0, 200)}` : ''
  return ` · polizza: ${pol.esito}${where}${why}`
}
