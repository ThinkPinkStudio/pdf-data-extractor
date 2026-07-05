/* eslint-disable @typescript-eslint/no-explicit-any */
// Rilevamento del profilo di estrazione (INCENDIO, RCA, RCT, RCTOP…) per un
// job polizza. I candidati vengono scelti ESCLUSIVAMENTE tra i profili salvati
// dall'utente (settings.polizzaProfiles): nessun set di campi viene inventato.
// Due segnali, combinati:
//   1. il ramo ricavato dalla cartella di provenienza (deterministico, forte);
//   2. un classificatore LLM sul testo delle prime pagine (top-3 con confidenza).
// Se il ramo è riconosciuto ma nessun profilo salvato corrisponde, il risultato
// è solo informativo (profileId null): l'estrazione prosegue con i campi correnti.

import { importSharedService } from './sharedServices'
import type { PolizzaProfile } from './settingsStore'
import type { ProfileCandidate } from './polizzaJobStore'

interface PathMetadataSvc {
  normalizeSegment: (s: string) => string
  RAMO_ALIASES: Map<string, string>
}
interface LlmSvc {
  streamChatWithProvider: (settings: any, messages: { role: string; content: string }[]) => AsyncGenerator<string>
}

// Risolve un nome libero (nome profilo o cartella) nel ramo canonico, con la
// stessa logica tollerante del parser dei percorsi.
async function resolveRamo(name: string): Promise<string | null> {
  const { normalizeSegment, RAMO_ALIASES } = await importSharedService<PathMetadataSvc>('pathMetadata.js')
  const norm = normalizeSegment(name)
  if (!norm) return null
  if (RAMO_ALIASES.has(norm)) return RAMO_ALIASES.get(norm) ?? null
  for (const [alias, canon] of RAMO_ALIASES) {
    if (alias.length >= 3 && (norm === alias || norm.startsWith(alias + ' ') || norm.endsWith(' ' + alias))) return canon
  }
  return null
}

function stripJson(raw: string): string {
  return raw.replace(/^```(?:json)?/m, '').replace(/```\s*$/m, '').trim()
}

async function collectStream(gen: AsyncGenerator<string>): Promise<string> {
  let out = ''
  for await (const chunk of gen) out += chunk
  return out
}

// Classificatore LLM: sceglie tra i profili salvati leggendo l'inizio del
// fascicolo. Restituisce al più 3 candidati validi (profileId esistente).
async function llmCandidates(
  sampleText: string,
  profiles: PolizzaProfile[],
  settings: any
): Promise<ProfileCandidate[]> {
  if (!sampleText || sampleText.trim().length < 80) return []
  const { streamChatWithProvider } = await importSharedService<LlmSvc>('llmService.js')
  const list = profiles.map((p, i) => `${i + 1}. id="${p.id}" nome="${p.name}"`).join('\n')
  const system =
`Sei un classificatore di polizze assicurative italiane. Dato l'inizio del testo di un fascicolo, individua a quale PROFILO di estrazione (ramo/tipologia) appartiene, scegliendo SOLO tra i profili elencati. Rispondi ESCLUSIVAMENTE con un array JSON (max 3 elementi, ordinati per plausibilità):
[{"profileId": "<id>", "confidence": 0.0-1.0, "motivo": "<max 10 parole>"}]
Se nessun profilo è plausibile rispondi [].`
  const user = `PROFILI DISPONIBILI:\n${list}\n\nINIZIO DEL TESTO DEL FASCICOLO:\n"""\n${sampleText.slice(0, 4000)}\n"""`

  const raw = await collectStream(streamChatWithProvider(settings, [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ]))
  let parsed: any
  try { parsed = JSON.parse(stripJson(raw)) } catch { return [] }
  if (!Array.isArray(parsed)) return []
  const valid = new Map(profiles.map((p) => [p.id, p]))
  return parsed
    .filter((c: any) => c && valid.has(String(c.profileId)))
    .slice(0, 3)
    .map((c: any): ProfileCandidate => ({
      profileId: String(c.profileId),
      profileName: valid.get(String(c.profileId))!.name,
      confidence: Math.max(0, Math.min(1, Number(c.confidence) || 0)),
      motivo: typeof c.motivo === 'string' ? c.motivo.slice(0, 200) : undefined,
      source: 'llm',
    }))
}

export async function detectProfile(params: {
  ramoFromPath: string | null
  sampleText: string
  savedProfiles: PolizzaProfile[]
  settings: any
}): Promise<ProfileCandidate[]> {
  const { ramoFromPath, sampleText, savedProfiles, settings } = params
  const candidates: ProfileCandidate[] = []

  // 1. Segnale dal percorso: il ramo della cartella abbinato per nome/alias a
  //    un profilo salvato.
  if (ramoFromPath) {
    let matched: PolizzaProfile | null = null
    for (const p of savedProfiles) {
      const profRamo = await resolveRamo(p.name)
      if (profRamo && profRamo === ramoFromPath) { matched = p; break }
    }
    candidates.push({
      profileId: matched?.id ?? null,
      profileName: matched?.name ?? null,
      ramo: ramoFromPath,
      confidence: matched ? 0.9 : 0.5,
      motivo: matched ? `cartella di provenienza "${ramoFromPath}"` : `ramo "${ramoFromPath}" dal percorso, nessun profilo salvato corrispondente`,
      source: 'path',
    })
  }

  // 2. Classificatore LLM sui profili salvati (best-effort: un errore del
  //    provider non blocca il job).
  if (savedProfiles.length > 0) {
    try {
      const llm = await llmCandidates(sampleText, savedProfiles, settings)
      for (const c of llm) {
        const existing = candidates.find((x) => x.profileId && x.profileId === c.profileId)
        if (existing) {
          // Concordanza path+LLM: tiene la confidenza più alta e unisce i motivi.
          existing.confidence = Math.max(existing.confidence, c.confidence)
          if (c.motivo) existing.motivo = `${existing.motivo || ''}; LLM: ${c.motivo}`.replace(/^; /, '')
        } else {
          candidates.push(c)
        }
      }
    } catch { /* solo segnale path */ }
  }

  // Ordina per confidenza; a parità vince il segnale path (deterministico).
  candidates.sort((a, b) => (b.confidence - a.confidence) || (a.source === 'path' ? -1 : 1))
  return candidates.slice(0, 3)
}
