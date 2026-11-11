/**
 * Fascicoli GOLDEN → cartella/file in polizze_test. Condiviso da
 * coverage-check.mjs (copertura del testo) e calibrazione-goldens.mjs
 * (estrazione reale + punteggio). Un file assente = caso saltato.
 */
// Fascicoli golden → cartella/file in polizze_test. Un file assente = caso saltato
// (i golden LAMBRATE/TAXIBLU non hanno il PDF nel repo).
export const CASES = [
  { id: 'guffanti', profile: 'Tutela Legale 3', golden: 'test/fixtures/calibrazione-guffanti-expected.json', dir: 'polizze_test/guffanti' },
  { id: 'lambrate', profile: 'Tutela Legale 3', golden: 'test/fixtures/golden-lambrate.json', dir: 'polizze_test/tutela legale', files: ['LAMBRATE 3 COND. - STUDIO MA_TUT. LEGALE_LAMBRATE 3 CONDOMINIO (1).pdf'] },
  { id: 'taxitutela', profile: 'Tutela Legale 3', golden: 'test/fixtures/golden-taxitutela.json', dir: 'polizze_test/tutela legale', files: ['TAXIBLU_TAXIBLU TUT. LEGALE AUTO FL592TG_POLIZZA BASE_TAXIBLU - FIAT PANDA DJ665KG.pdf'] },
  { id: 'rcp-pilato', profile: 'Rc Professionale V3', golden: 'test/fixtures/calibrazione-rcp-pilato-expected.json', dir: 'polizze_test/rcp rc professionali', files: ['Polizza RC Professionale BL05000049 Pilato Franco.pdf'] },
  { id: 'rcp-saporiti', profile: 'Rc Professionale V3', golden: 'test/fixtures/calibrazione-rcp-saporiti-expected.json', dir: 'polizze_test/rcp rc professionali', files: ['Polizza Rc Professionale BL05002415 Saporiti Massimo.pdf'] },
  { id: 'rcp-cresta', profile: 'Rc Professionale V3', golden: 'test/fixtures/calibrazione-rcp-cresta-expected.json', dir: 'polizze_test/rcp rc professionali', files: ['Polizza Rc Professionale BLUE053434 Cresta  Associati .pdf'] },
  { id: 'rcpm-lucca', profile: 'RC PROF MED V2', golden: 'test/fixtures/calibrazione-rcpm-lucca-expected.json', dir: 'polizze_test/rcpm rc professionale medica', files: ['LUCCA_VIVIANA.pdf'] },
  { id: 'eulip-locale', profile: 'RCT RCO', golden: 'test/fixtures/calibrazione-eulip-locale-expected.json', dir: 'polizze_test/eulip' },
]

// Golden a VERITÀ PIENA (test/fixtures/full-*.json, Regola 4: una verità per
// OGNI campo del profilo, valore o vuoto). Profili = quelli in uso
// (profili-polizza-riconoscimento.json: descrizioni v2 + «Come riconoscerla»);
// `profileJson` per caso sovrascrive il file dei profili. `dir` è letto
// RICORSIVAMENTE (i pezzi in sottocartella, es. «…/POLIZZA», fanno parte del
// fascicolo). `files` limita ai file indicati (percorsi relativi a `dir`).
export const FULL_PROFILES = 'polizze_test/profili-polizza-riconoscimento.json'
export const FULL_CASES = [
  { id: 'bolchini-rc-2026', profile: 'Rc Professionale V3', golden: 'test/fixtures/full-bolchini-rc-2026.json', dir: 'polizze_test/BOLCHINI MARGHERITA/In vigore/RC PROF. 04.2026' },
  { id: 'bolchini-rc-2025', profile: 'Rc Professionale V3', golden: 'test/fixtures/full-bolchini-rc-2025.json', dir: 'polizze_test/BOLCHINI MARGHERITA/Cessate/RC PROF. 04.2025' },
  { id: 'guffanti-rc-2025', profile: 'Rc Professionale V3', golden: 'test/fixtures/full-guffanti-rc-2025.json', dir: 'polizze_test/GUFFANTI GROUP/GUFFANTI GROUP RC PROF 06.2025( CESSATA 06.2026)' },
  { id: 'guffanti-rc-2026', profile: 'Rc Professionale V3', golden: 'test/fixtures/full-guffanti-rc-2026.json', dir: 'polizze_test/GUFFANTI GROUP/GUFFANTI GROUP RINNOVO RC PROF. 06.2026' },
  { id: 'spallino-rc', profile: 'Rc Professionale V3', golden: 'test/fixtures/full-spallino-rc.json', dir: 'polizze_test/SPALLINO LORENZO E STUDIO/SPALLINO LORENZO studio Legale RC PROF' },
  { id: 'rcp-pilato', profile: 'Rc Professionale V3', golden: 'test/fixtures/full-rcp-pilato.json', dir: 'polizze_test/rcp rc professionali', files: ['Polizza RC Professionale BL05000049 Pilato Franco.pdf'] },
  { id: 'rcp-saporiti', profile: 'Rc Professionale V3', golden: 'test/fixtures/full-rcp-saporiti.json', dir: 'polizze_test/rcp rc professionali', files: ['Polizza Rc Professionale BL05002415 Saporiti Massimo.pdf'] },
  { id: 'rcp-cresta', profile: 'Rc Professionale V3', golden: 'test/fixtures/full-rcp-cresta.json', dir: 'polizze_test/rcp rc professionali', files: ['Polizza Rc Professionale BLUE053434 Cresta  Associati .pdf'] },
  { id: 'rcpm-lucca', profile: 'RC PROF MED V2', golden: 'test/fixtures/full-rcpm-lucca.json', dir: 'polizze_test/rcpm rc professionale medica', files: ['LUCCA_VIVIANA.pdf'] },
  { id: 'guffanti-tl', profile: 'Tutela Legale 3', golden: 'test/fixtures/full-guffanti.json', dir: 'polizze_test/guffanti' },
  { id: 'bolchini-tl', profile: 'Tutela Legale 3', golden: 'test/fixtures/full-bolchini-tl.json', dir: 'polizze_test/BOLCHINI MARGHERITA/In vigore/TUT. LEGALE PROF' },
  { id: 'spallino-tl', profile: 'Tutela Legale 3', golden: 'test/fixtures/full-spallino-tl.json', dir: 'polizze_test/SPALLINO LORENZO E STUDIO/SPALLINO LORENZO Tutela legale GJ009XD' },
  // ALZAIA: UN solo file, la QUIETANZA di rinnovo DAS, nessuna polizza. Regola
  // dell'utente (26/09/2026): «SE NON HAI UNA POLIZZA NON ESTRAI! SENZA UNA
  // POLIZZA È SEMPRE NON VALIDO». Non è più un caso di ESTRAZIONE (i suoi 23
  // campi non contano): è un controllo di VALIDITÀ, giusto se l'app lo
  // dichiara «Non valido» e non estrae nulla.
  { id: 'alzaia-tl', profile: 'Tutela Legale 3', golden: 'test/fixtures/full-alzaia-tl.json', dir: 'polizze_test/PIZZAMIGLIO GUIA AMM.NE STABILI -GRUPPO/ALZAIA NAVIGLIO PAVESE 104/ALZAIA NAVIGLIO PAVESE 101 Tutela legale DAS', expect: 'non-valido', why: 'una sola quietanza di pagamento, nessuna polizza' },
  // EULIP (full-eulip-locale.json) NON è a verità piena: 13 campi su 24 del
  // profilo RCT RCO. Fuori dal confronto finché il golden non copre tutto.
]
