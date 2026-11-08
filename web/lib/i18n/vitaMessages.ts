// Testi della sezione Polizza Vita (08/11/2026), uniti al catalogo principale
// in messages.ts. Le schermate della sezione hanno ancora i testi in italiano
// nei componenti (versione da far provare al cliente); qui il menu e gli interruttori.

export const vitaMessages: Record<'it' | 'en', Record<string, string>> = {
  it: {
    'nav.secVita': 'Polizza Vita',
    'nav.subVita': 'POLIZZA VITA',
    'hub.vitaDesc': 'Assicurati della polizza vita collettiva: stato di rischio, documentazione sanitaria, movimenti e rinnovo.',
    'nav.vitaStato': 'Stato di rischio',
    'nav.vitaSanitaria': 'Doc. sanitaria',
    'nav.vitaMovimenti': 'Movimenti',
    'nav.vitaRinnovo': 'Rinnovo di fine anno',
    'nav.vitaSettings': 'Tassi e regole',
    'set.vitaVisible': 'Sezione «Polizza Vita» nella pagina iniziale',
    'set.vitaVisibleHint': 'Spenta: la scheda non compare nella pagina iniziale; le pagine restano raggiungibili da /vita per le prove.',
  },
  en: {
    'nav.secVita': 'Group life policy',
    'nav.subVita': 'GROUP LIFE POLICY',
    'hub.vitaDesc': 'Members of the group life policy: risk status, medical documents, movements and year-end renewal.',
    'nav.vitaStato': 'Risk status',
    'nav.vitaSanitaria': 'Medical docs',
    'nav.vitaMovimenti': 'Movements',
    'nav.vitaRinnovo': 'Year-end renewal',
    'nav.vitaSettings': 'Rates and rules',
    'set.vitaVisible': '«Group life policy» section on the home page',
    'set.vitaVisibleHint': 'Off: the card is hidden from the home page; the pages stay reachable at /vita for testing.',
  },
}
