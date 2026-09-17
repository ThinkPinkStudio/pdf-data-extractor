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
