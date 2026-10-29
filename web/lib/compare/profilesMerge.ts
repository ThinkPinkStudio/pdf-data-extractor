// Lettura della lista «Profili salvati»: profili della chiave propria + quelli
// di una chiave STORICA convertiti (es. i profili del vecchio Confronto righe
// nella Comparazione).
//
// Regola: i profili PROPRI non possono mai sparire per colpa della conversione
// dei vecchi. Prima la conversione girava per prima, dentro la stessa `then`
// del fetch: una sola voce storica malformata faceva saltare tutto nel `catch`
// e la lista restava vuota senza dire niente (nella vecchia pagina Comparazione
// non c'era conversione, quindi i profili si vedevano sempre).

export interface MergedProfiles<T> {
  own: Record<string, T> // i profili della chiave propria, sempre e comunque
  converted: Record<string, T> // i vecchi, convertiti (nomi già liberi da collisioni)
  broken: string[] // i vecchi che non si è riusciti a convertire: si elencano lo stesso
}

export function mergeProfileLists<T>(
  settings: Record<string, unknown>,
  settingsKey: string,
  legacyKey?: string,
  convertLegacy?: (legacy: unknown) => T | null,
  legacySuffix = ' (vecchio profilo)'
): MergedProfiles<T> {
  const p = settings ? settings[settingsKey] : null
  const own = p && typeof p === 'object' ? ({ ...(p as Record<string, T>) }) : {}
  const converted: Record<string, T> = {}
  const broken: string[] = []

  const legacy = legacyKey && settings ? settings[legacyKey] : null
  if (legacy && typeof legacy === 'object' && convertLegacy) {
    for (const [n, lp] of Object.entries(legacy as Record<string, unknown>)) {
      let conv: T | null = null
      try { conv = convertLegacy(lp) } catch { conv = null }
      if (!conv) { broken.push(n); continue }
      const name = own[n] ? n + legacySuffix : n
      if (!own[name] && !converted[name]) converted[name] = conv
    }
  }
  return { own, converted, broken }
}
