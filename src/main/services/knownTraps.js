/**
 * Sezione «TRAPPOLE CONOSCIUTE» dei prompt di estrazione.
 *
 * Few-shot NEGATIVO type-blind: trasforma in istruzioni le guardie già
 * esistenti (isRinvioAttivita, isCompanyNameAsAgency, isInsurerFooterPIva,
 * sub-limite vs massimale). Zero schema, zero costo LLM extra — solo token
 * di system prompt. Usata da tutti i motori (staged / recovery / cascade /
 * per-campo / fascicolo intero).
 */

export const KNOWN_TRAPS =
  'TRAPPOLE CONOSCIUTE (errori frequenti — se ti riconosci, OMETTI il campo):\n' +
  '• Un sub-limite di una clausola (es. 10.000,00 o "massimale ridotto per…") NON è il massimale della polizza → ometti.\n' +
  '• Un\'agenzia "S.p.A." / "S.r.l." / "Assicurazioni …" NON è una piazza di agenzia → ometti se compare una dicitura societaria.\n' +
  '• Una P.IVA che compare SOLO nel footer societario (Sede legale, Capitale Sociale, Registro Imprese, IVASS) NON è quella del contraente.\n' +
  '• L\'attività NON può essere un rinvio ("per la quale è prestata l\'assicurazione", "vedi polizza", "attività della ditta contraente") → ometti.\n' +
  '• Decorrenza e scadenza nella stessa quietanza: usa il PERIODO DI COPERTURA della rata, non date di altre sezioni o di emissione.\n' +
  '• PREVENTIVO ≠ CONSUNTIVO: non copiare il consuntivo di una regolazione su un campo preventivo.\n'
