// Campi di VERIFICA ("Verifica se…") e citazioni del modello (analisi errori
// 25/09/2026, F01 + F10 c/d/e): la citazione di una risposta deve NOMINARE
// l'oggetto della verifica letto dalla testa della descrizione; è obbligatoria
// e deve stare nel testo inviato anche spezzata dai puntini (ogni pezzo sulla
// stessa pagina, in ordine); le risposte che la descrizione prescrive ("scrivi
// 'Nessuna'") si giudicano dalla citazione; l'eco della descrizione di un altro
// campo non è un dato. Stringhe reali dei fascicoli RCP PILATO/SAPORITI/
// CRESTA, SPALLINO RC, GUFFANTI RC, BOLCHINI RC, LUCCA; descrizioni reali dei
// profili (polizze_test/profili-polizza-riconoscimento.json).
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  descriptionHeadText, verificationObjectPhrases, evidenceNamesObject, objectRadix,
} from '../src/services/polizzaFieldKind.js'
import {
  passesStagedEvidence, normForMatch, evidenceSegments, evidenceInContext,
  descriptionPrescribedAnswers, isPrescribedAnswer, descriptionEchoPhrase,
} from '../src/services/polizzaValidation.js'
import {
  absorbStagedEntries, verificationObjectsByField, paraphraseHint,
} from '../src/services/polizzaService.js'

const PROFILES = JSON.parse(readFileSync(new URL('../polizze_test/profili-polizza-riconoscimento.json', import.meta.url), 'utf8'))
const RC = PROFILES.find((p) => p.name === 'Rc Professionale V3').fields
const MED = PROFILES.find((p) => p.name === 'RC PROF MED V2').fields
const byLabel = (fields, label) => fields.find((f) => String(f.label).trim() === label)
const phrasesOf = (fields, label) => verificationObjectPhrases(byLabel(fields, label), fields)
const altTexts = (fields, label) => phrasesOf(fields, label).map((p) => p.code || p.words.join(' '))
const names = (fields, label, quote) => evidenceNamesObject(quote, phrasesOf(fields, label))

test('descriptionHeadText: la testa finisce ai due punti o a [.;] + spazio + MAIUSCOLA, mai sulle abbreviazioni', () => {
  // "ex D.Lgs. 231/2001": col taglio a ogni punto spariva "consigliere di amministrazione…"
  assert.equal(descriptionHeadText(byLabel(RC, 'ODV / CDA').description),
    'Verifica se sono coperti gli incarichi in Organismo di Vigilanza ex D.Lgs. 231/2001, consigliere di amministrazione o amministratore di società/enti')
  assert.match(descriptionHeadText(byLabel(RC, 'Legge Merloni / Appalti').description), /D\.Lgs\. 163\/2006, 50\/2016 o 36\/2023\)$/)
  // "ARCH. MARGHERITA" sta tra parentesi: la frase continua
  assert.match(descriptionHeadText(byLabel(RC, 'Contraente/Assicurato').description), /Guffanti Group & Partners Srl\)$/)
  // ". È il codice…" chiude (punto + spazio + maiuscola)
  assert.equal(descriptionHeadText(byLabel(RC, 'P. IVA / Cod. Fiscale').description), 'Partita IVA o codice fiscale del CONTRAENTE/assicurato (es. 02698680150)')
  assert.equal(descriptionHeadText('Verifica se presente garanzia Tutela e/o Tutela Legale.'), 'Verifica se presente garanzia Tutela e/o Tutela Legale')
})

test('verificationObjectPhrases: alternative dalla testa della descrizione, parole generiche mai obbligatorie (profilo Rc Professionale V3 reale)', () => {
  // "garanzia" sta anche nelle teste di Sottolimiti ed Estensioni: non è l'oggetto.
  // Dal 26/09 anche «Visto pesante / bonus edilizi» e i due massimali visto sono
  // verifiche: "visto" sta nelle teste di quattro verifiche e non distingue più,
  // resta "leggero" (la parola che separa il visto leggero dal pesante).
  assert.deepEqual(altTexts(RC, 'Visto leggero'), ['leggero', 'assistenza fiscale', 'compensazione crediti'])
  // "incarichi" sta nelle teste di tre verifiche: non è obbligatorio
  assert.deepEqual(altTexts(RC, 'Sindaco / Revisore'), ['sindaco', 'revisore legale', 'collegio sindacale', 'organo controllo'])
  // riferimento normativo = alternativa a sé; "società/enti" (parola corta)
  // resta dentro la frase, mai "enti" da solo
  assert.deepEqual(altTexts(RC, 'ODV / CDA'), ['organismo vigilanza', 'consigliere amministrazione', 'amministratore societa', 'amministratore enti', '231/2001'])
  assert.ok(!altTexts(RC, 'ODV / CDA').includes('enti'))
  assert.deepEqual(altTexts(RC, 'Progettazione / DL'),
    ['progettazione', 'direzione lavori', 'coordinamento sicurezza', 'collaudo', 'certificazioni energetiche', 'asseverazioni tecniche'])
  assert.deepEqual(altTexts(RC, 'Legge Merloni / Appalti'),
    ['progettista', 'direttore lavori appalti pubblici', 'legge merloni', '109/1994', '163/2006', '50/2016', '36/2023'])
  // esempi citati nella parte positiva ("es. 'rappresentanza e difesa…'") come alternative
  const giud = altTexts(RC, 'Attività giudiziale / stragiudiziale')
  // Dal 26/09 (descrizioni nuove) "attività" non sta più nella testa di un'altra
  // verifica: la frase è "attività giudiziale", le alternative restano.
  assert.ok(giud.includes('attivita giudiziale') && giud.includes('stragiudiziale') && giud.includes('arbitrato'))
  assert.ok(giud.includes('rappresentanza difesa autorita giudiziaria') && giud.includes('perizie giudiziali'))
  assert.deepEqual(altTexts(RC, 'Incarichi giudiziari'), ['curatore', 'custode giudiziario', 'delegato vendite', 'consulente tecnico ufficio', 'conferiti autorita giudiziaria'])
  assert.deepEqual(altTexts(RC, 'Custodia documenti / valori'), ['perdita', 'custodia documenti', 'somme', 'titoli', 'valori', 'perdita documenti'])
  // "risultano DICHIARATI sinistri": il predicato chiude il preambolo; "sinistri"
  // resta anche se il massimale "per singolo sinistro" usa la parola
  assert.deepEqual(altTexts(RC, 'Sinistri e circostanze'), ['questionario', 'sinistri', 'richieste risarcimento', 'circostanze note'])
  // profilo medico: "Verifica se presente garanzia Tutela e/o Tutela Legale."
  assert.deepEqual(altTexts(MED, 'Tutela'), ['tutela', 'tutela legale'])
  // dal 26/09 il massimale del visto leggero è una verifica («Indica se e con
  // quale massimale…»): stesso oggetto del Visto leggero
  assert.deepEqual(altTexts(RC, 'Massimale visto leggero'), ['leggero', 'assistenza fiscale', 'compensazione crediti'])
  // campi che non pongono una verifica: nessuna alternativa
  assert.deepEqual(phrasesOf(RC, 'Esclusioni particolari'), [])
})

test('verificationObjectPhrases: la frequenza documentale è su TUTTE le teste del profilo, non solo sulle verifiche', () => {
  const visto = { id: 'v', label: 'x', description: "Verifica se la polizza comprende la garanzia visto leggero: 'presente' se nominata; vuoto altrimenti." }
  const sola = verificationObjectPhrases(visto, [visto])
  assert.deepEqual(sola.map((p) => p.words.join(' ')), ['garanzia visto leggero'], 'da sola nessuna parola risulta generica')
  const sottolimiti = { id: 's', label: 'y', description: 'Elenco dei sottolimiti con la garanzia a cui si riferiscono.' }
  assert.deepEqual(verificationObjectPhrases(visto, [visto, sottolimiti]).map((p) => p.words.join(' ')), ['visto leggero'])
  // la barra spezza solo tra parole di almeno 5 lettere
  const odv = { id: 'o', label: 'z', description: "Verifica se sono coperti gli incarichi di amministratore di società/enti o visto leggero / assistenza fiscale: 'Sì' se inclusi." }
  assert.deepEqual(verificationObjectPhrases(odv, [odv]).map((p) => p.words.join(' ')),
    ['incarichi amministratore societa', 'incarichi amministratore enti', 'visto leggero', 'assistenza fiscale'])
})

test('objectRadix: flessione e derivati sulla radice, parole corte intere', () => {
  assert.equal(objectRadix('Progettista'), objectRadix('progettazione'))
  assert.equal(objectRadix('Coordinatore'), objectRadix('coordinamento'))
  assert.equal(objectRadix('sindaci'), objectRadix('Sindaco'))
  assert.equal(objectRadix('perdite'), objectRadix('Perdita'))
  assert.equal(objectRadix('enti'), 'ent')
  assert.notEqual(objectRadix('documenti'), objectRadix('enti'))
  assert.notEqual(objectRadix('organismo'), objectRadix('organo'))
})

// Citazioni REALI che oggi davano risposte SBAGLIATE: devono cadere.
const DROP = [
  // spallino-rc / rcp-pilato: visto leggero "presente" su garanzia B
  ['Visto leggero', 'B:   Consulenza Fiscale      La Società si obbliga a tenere indenne l’ Assicurato da ogni somma che questi sia tenuto a pagare o a rimborsare a terzi , per Danni involontariamente cagionate a terzi nell’espletamento di consulenza fiscale.'],
  ['Visto leggero', 'B.  Consulenza Fiscale  La Società si obbliga a tenere indenne l’ Assicurato da ogni somma che questi sia tenuto a pagare o a rimborsare a Terzi , a titolo di risarcimento per le Perdite pecuniarie cagionate nell’espletamento dell’attività di consulenza fiscale.'],
  // rcp-saporiti: "presente" preso da "La presente Estensione…" (3.1 Perdita di Documenti)
  ['Visto leggero', 'La presente Estensione sarà soggetta ad un sottolimite di € 150.000,00 (euro centocinquantamila) per Sinistro e per anno'],
  ['Visto leggero', '3.7 Attività di tributarista'],
  // rcp-pilato: sindaco/revisore "Sì" sulla garanzia C
  ['Sindaco / Revisore', 'è compreso l’incarico di Curatore nelle procedure di fallimento, di Commissario Giudiziale nelle procedure di concordato preventivo e di amministrazione controllata'],
  // rcp-pilato: ODV "Sì" su "Amministratore di sostegno" (anche con "La Società" prima)
  ['ODV / CDA', 'Attività di tutore o protutore di minori od interdetti; di curatore di scomparso, di emancipato e/o inabilitato, nonché Amministratore di sostegno; Giudice di Pace'],
  ['ODV / CDA', 'C.  Funzioni Pubbliche/ La Società si obbliga a tenere indenne l’ Assicurato … nonché Amministratore di sostegno; Giudice di Pace'],
  // rcp-pilato / rcp-saporiti / spallino-rc / rcp-cresta: progettazione "Sì" da pag. 4
  ['Progettazione / DL', "a) attività di rappresentanza e difesa dinanzi all'autorità giudiziaria o ad arbitri, tanto rituali quanto irrituali;"],
  ['Progettazione / DL', 'c) consulenza od assistenza stragiudiziali;'],
  ['Progettazione / DL', 'A:   Responsabilità civile    L’ Assicurazione è prestata per la responsabilità civile ai sensi di legge derivante all’ Assicurato nell’esercizio dell’attività professionale'],
  ['Progettazione / DL', 'C:   Funzioni Pubbliche/      La Società si obbliga a tenere indenne l’ Assicurato da ogni somma'],
]
// Citazioni REALI delle risposte GIUSTE di oggi (e delle risposte giuste perse): restano.
const KEEP = [
  ['Attività giudiziale / stragiudiziale', "a) attività di rappresentanza e difesa dinanzi all'autorità giudiziaria o ad arbitri, tanto rituali quanto irrituali;"],
  ['Attività giudiziale / stragiudiziale', 'c) consulenza od assistenza stragiudiziali;'],
  ['Attività giudiziale / stragiudiziale', 'D:   Arbitrato                La Società si obbliga a tenere indenne l’ Assicurato da ogni somma che questi sia tenuto a pagare o a rimborsare a terzi nell’espletamento delle funzioni di arbitro rituale o irrituale.'],
  ['Attività giudiziale / stragiudiziale', '▪ Incarichi di perito per perizie giudiziali ed extragiudiziali;'],
  ['Attività giudiziale / stragiudiziale', '2. 1 1 - Attività di Mediazione finalizzata alla Conciliazione'],
  ['Incarichi giudiziari', 'è compreso l’incarico di Curatore nelle procedure di fallimento, di Commissario Giudiziale nelle procedure di concordato preventivo'],
  ['Incarichi giudiziari', 'Si intende inclusa all’attività inerente esecuzioni immobiliari ex L.302/1998 e custode giudiziario ex L. 80/2005'],
  ['Incarichi giudiziari', '▪ Incarichi di consulente tecnico d’ufficio nominato dall’Autorità Giudiziaria;'],
  ['Custodia documenti / valori', '3.1 Perdita di Documenti e Valori'],
  ['Custodia documenti / valori', '2. 6 - Perdita di documenti'],
  ['Custodia documenti / valori', 'la perdita, il danneggiamento, lo smarrimento o la distruzione di Documenti'],
  // GUFFANTI RC 2025/2026, Art. 1 Oggetto e 2.10
  ['Progettazione / DL', '▪ Attività di progettista;'],
  ['Progettazione / DL', '▪ Certificazioni Energetiche ai sensi del D.Lgs. n. 192/2005'],
  ['Progettazione / DL', 'Coordinatore per la Progettazione, Coordinatore per l’Esecuzione dei Lavori'],
  // GUFFANTI RC, art. 10 a): il "No" di sindaco e ODV
  ['Sindaco / Revisore', 'in particolare l’assicurazione non opera in relazione alla funzione di amministratore, membro del consiglio direttivo, commissario o sindaco, o funzioni equivalenti, di società, aziende, associazioni'],
  ['ODV / CDA', 'in particolare l’assicurazione non opera in relazione alla funzione di amministratore, membro del consiglio direttivo, commissario o sindaco, o funzioni equivalenti, di società, aziende, associazioni'],
  // RCP PILATO 4.16: la prova del "No"
  ['Sindaco / Revisore', "non vale in relazione all'attività di Sindaco o Revisore legale dei Conti di società od enti, membro di CDA di società di capitali, membro di Organo di controllo e Sorveglianza, membro di ODV ai sensi del D.Lgs 231/2001"],
  ['ODV / CDA', "non vale in relazione all'attività di Sindaco o Revisore legale dei Conti di società od enti, membro di CDA di società di capitali, membro di Organo di controllo e Sorveglianza, membro di ODV ai sensi del D.Lgs 231/2001"],
  // SPALLINO RC, evidenza registrata nel log
  ['ODV / CDA', 'Incarichi di Membro Organismo di Vigilanza (OdV) / Consiglio di Sorveglianza'],
  // BOLCHINI RC 2026 (Sì) e questionari (No)
  ['Sinistri e circostanze', '14 a) Data del sinistro 12 ottobre 2025'],
  ['Sinistri e circostanze', '9  Per quanto potete sapere e supporre, negli ultimi 5 anni sono mai state avanzate richieste di risarcimento'],
  ['Sinistri e circostanze', '5.1 Negli ultimi 5 anni sono state avanzate Richieste di Risarcimento nei confronti:'],
  // GUFFANTI RC 2026, 2.10: codici con le cifre spezzate dal kerning
  ['Legge Merloni / Appalti', '▪  alla L egge n. 109/1994 ed al D. Lgs. 50 /20 1 6 per l’attività di Direttore dei Lavori.'],
  ['Legge Merloni / Appalti', '2. 10 - D. Lgs. 81/2008 – D. Lgs. 624/1996 – Legge n. 109/1994 – D. Lgs. 50 / 201 6'],
  ['Legge Merloni / Appalti', 'Art. 1 - ESCLUSIONE D. Lgs. 81/2008 – D. Lgs. 624/1996 – Legge n. 109/1994 – D. Lgs. 163/06'],
]

test('evidenceNamesObject: le citazioni reali delle risposte SBAGLIATE cadono', () => {
  for (const [label, quote] of DROP) assert.equal(names(RC, label, quote), false, `${label}: ${quote.slice(0, 60)}`)
})

test('evidenceNamesObject: le citazioni reali delle risposte GIUSTE restano', () => {
  for (const [label, quote] of KEEP) assert.equal(names(RC, label, quote), true, `${label}: ${quote.slice(0, 60)}`)
  // LUCCA: certificato separato di Tutela Medici
  assert.equal(names(MED, 'Tutela', 'AMTRUST TUTELA MEDICI'), true)
  assert.equal(names(MED, 'Tutela', 'Sede legale: Via Clerici 14'), false)
})

test('evidenceNamesObject: parola intera, nell\'ordine, citazione vuota mai', () => {
  const odv = phrasesOf(RC, 'ODV / CDA')
  assert.equal(evidenceNamesObject('amministratore della documentazione', odv), false, '"enti" non sta dentro "documentazione"')
  assert.equal(evidenceNamesObject('amministratore di enti pubblici', odv), true)
  assert.equal(evidenceNamesObject('', odv), false)
  assert.equal(evidenceNamesObject('qualsiasi cosa', []), true, 'nessuna alternativa: controllo non applicabile')
})

// GUFFANTI RC 2026, Documento 1 pag. 17 (griglia pdf.js): il 2.10 a punti elenco.
const GUFFANTI_P17 = [
  '             2. 10 - D. Lgs. 81/2008 – D. Lgs. 624/1996 – Legge n. 109/1994 – D. Lgs. 50 / 201 6',
  '             La garanzia assicurativa delimitata in questa P olizza comprende la responsabilità civile derivant e',
  '             all’Assicurato dalla normativa di cui:',
  '                ▪  al Decreto Legislativo n.81 del 9 aprile 2008 per gli incarichi assunti in materia di salute e',
  '                   sicurezza sui luoghi di lavoro (responsabile del servizio Prevenzione e Protezione,',
  '                   rappresentante per la Sicurezza) e in materia di sicurezza nei cantieri (Responsabile dei Lavori,',
  '                   Coordinatore per la Progettazione, Coordinatore per l’Esecuzione dei Lavori). Restano',
  '                   comunque escluse tutte le sanzioni di natura fiscale inflitte direttamente all’ Assicurato ;',
  '                ▪  al Decreto Legislativo 624 del 25/11/1996 e s.m.i. per gli incarichi assunti in materia di sicurezza',
  '                   e salute dei lavoratori, compreso l’incarico di direttore responsabile e sorvegliante;',
  '                ▪  alla L egge n. 109/1994 ed al D. Lgs. 50 /20 1 6 per l’attività di Direttore dei Lavori.',
].join('\n')
// GUFFANTI RC 2026, Documento 1 pag. 6: la scheda con le estensioni (casella NO barrata = glifo privato + ✘ "8")
const GUFFANTI_P6 = [
  '                  CONDIZIONI SPECIALI – ESTENSIONI DI GARANZIA              Operante',
  '           Art. 1 - ESCLUSIONE D. Lgs. 81/2008 – D. Lgs. 624/1996 – Legge n.',
  '                                                                          SI       NO  8',
  '           109/1994 – D. Lgs. 163/06',
  '           Art. 3 - GENERAL CONTRACTOR                                    SI       NO  8',
  '                                          CONDIZIONI PARTICOLARI',
  '                                 (che prevalgono sulle Condizioni di Assicurazione allegate)',
  '           Non operante.',
].join('\n')
// GUFFANTI RC 2026, Documento 1 pag. 11
const GUFFANTI_P11 = '          Retroattività convenuta. Terminato il Periodo di Assicurazione, cessano gli obblighi de ll’ Assicurator e e\n          nessuna denuncia di Sinistro potrà essere accolta, fermo quanto previsto dai successivi Artt. 7 e 8 delle Norme'

test('evidenceSegments / evidenceInContext: citazione cucita coi puntini o coi punti elenco, pezzi contigui sulla STESSA pagina in ordine', () => {
  const raw = `[Documento 1 · pag. 17]\n${GUFFANTI_P17}\n\n[Documento 1 · pag. 6]\n${GUFFANTI_P6}`
  const n = normForMatch(raw)
  const cucita = 'La garanzia assicurativa delimitata in questa Polizza comprende la responsabilità civile … dalla normativa di cui: … alla Legge n. 109/1994 ed al D. Lgs. 50/2016 per l’attività di Direttore dei Lavori.'
  assert.deepEqual(evidenceSegments('a … b ... c ▪ d • e').length, 5)
  assert.equal(n.includes(normForMatch(cucita)), false, 'il vecchio controllo contiguo la scartava')
  assert.equal(evidenceInContext(cucita, n, raw), true)
  assert.equal(evidenceInContext('dalla normativa di cui: ▪ alla Legge n. 109/1994 ed al D. Lgs. 50/2016', n, raw), true, 'punto elenco')
  // ordine rovesciato: no
  assert.equal(evidenceInContext('alla Legge n. 109/1994 … dalla normativa di cui:', n, raw), false)
  // pezzi di due pagine diverse: no
  assert.equal(evidenceInContext('dalla normativa di cui: … CONDIZIONI PARTICOLARI', n, raw), false)
  // senza marcatori il contesto è una pagina sola
  assert.equal(evidenceInContext(cucita, normForMatch(GUFFANTI_P17), GUFFANTI_P17), true)
  assert.equal(evidenceInContext('', n, raw), false)
})

test('passesStagedEvidence, VERIFICHE: citazione obbligatoria e nel testo per ogni risposta, anche "presente"', () => {
  const visto = byLabel(RC, 'Visto leggero')
  const merloni = byLabel(RC, 'Legge Merloni / Appalti')
  // RCP SAPORITI pag. 9: "presente" stava nel testo come parola ("La presente Estensione")
  const p9 = '[Documento 1 · pag. 9]\n3.1 Perdita di Documenti e Valori\nLa presente Estensione sarà soggetta ad un sottolimite di € 150.000,00 (euro centocinquantamila) per Sinistro e per anno'
  const n9 = normForMatch(p9)
  assert.equal(passesStagedEvidence(visto, 'presente', { evidenza: 'Garanzia visto leggero: operante' }, n9, p9), false, 'citazione inventata')
  assert.equal(passesStagedEvidence(visto, 'presente', {}, n9, p9), false, 'senza citazione')
  assert.equal(passesStagedEvidence(visto, 'presente', { evidenza: 'La presente Estensione sarà soggetta ad un sottolimite' }, n9, p9), true, 'citazione vera (l\'oggetto lo giudica absorbStagedEntries)')
  // GUFFANTI RC 2026: il "Sì" alla Legge Merloni con la citazione cucita del 2.10 ora passa
  const raw = `[Documento 1 · pag. 17]\n${GUFFANTI_P17}`
  assert.equal(passesStagedEvidence(merloni, 'Sì', { evidenza: '…dalla normativa di cui: … alla Legge n. 109/1994 ed al D. Lgs. 50/2016 per l’attività di Direttore dei Lavori.' }, normForMatch(raw), raw), true)
  assert.equal(passesStagedEvidence(merloni, 'Sì', { evidenza: 'Legge Merloni operante' }, normForMatch(raw), raw), false)
})

test('descriptionPrescribedAnswers / isPrescribedAnswer: le risposte che la descrizione ordina di scrivere', () => {
  const est = byLabel(RC, 'Estensioni operative')
  assert.ok(descriptionPrescribedAnswers(est.description).includes('Nessuna'))
  assert.equal(isPrescribedAnswer(est, 'nessuna'), true)
  assert.equal(isPrescribedAnswer(est, 'Art. 2 Opere ad alto rischio'), false)
  const franchigiaMed = byLabel(MED, 'Franchigia base')
  assert.ok(descriptionPrescribedAnswers(franchigiaMed.description).includes('NESSUNA'))
  // risposte di una verifica
  assert.deepEqual(descriptionPrescribedAnswers(byLabel(RC, 'Visto leggero').description), ['presente', 'escluso'])
  // "se zero riporta '0,00'": un importo si giudica come importo, non come risposta prescritta
  const diritti = { id: 'd', label: 'Diritti', description: "Diritti COMPLESSIVI sul premio (es. 0,00, 2,48): se zero riporta '0,00'." }
  assert.equal(isPrescribedAnswer(diritti, '0,00'), false)
})

test('passesStagedEvidence, RISPOSTE PRESCRITTE: decide la citazione, non la parola trovata altrove nel batch', () => {
  const est = byLabel(RC, 'Estensioni operative')
  // scheda con le sei estensioni barrate NO e la pagina 11 con "nessuna denuncia"
  const raw = `[Documento 1 · pag. 6]\n${GUFFANTI_P6}\n\n[Documento 1 · pag. 11]\n${GUFFANTI_P11}`
  const n = normForMatch(raw)
  // citazione inventata: prima passava perché "nessuna" sta a pag. 11
  assert.equal(passesStagedEvidence(est, 'Nessuna', { evidenza: 'Estensioni operanti: Nessuna' }, n, raw), false)
  // citazione della scheda: passa anche senza "nessuna" nel batch (prima cadeva)
  const soloScheda = `[Documento 1 · pag. 6]\n${GUFFANTI_P6}`
  assert.equal(normForMatch(soloScheda).includes('nessuna'), false)
  assert.equal(passesStagedEvidence(est, 'Nessuna', { evidenza: 'Art. 3 - GENERAL CONTRACTOR SI NO 8' }, normForMatch(soloScheda), soloScheda), true)
  // LUCCA: "NESSUNA" copiato dalla cella; la citazione etichetta+valore non è
  // contigua nella griglia ma contiene la parola, e il testo la stampa
  const franchigiaMed = byLabel(MED, 'Franchigia base')
  const lucca = '[Documento 1 · pag. 1]\n    FRANCHIGIA PER SINISTRO               FRAZIONAMENTO\n                NESSUNA                               ANNUALE'
  assert.equal(passesStagedEvidence(franchigiaMed, 'NESSUNA', { evidenza: 'FRANCHIGIA PER SINISTRO NESSUNA' }, normForMatch(lucca), lucca), true)
  assert.equal(passesStagedEvidence(franchigiaMed, 'NESSUNA', { evidenza: 'FRANCHIGIA PER SINISTRO: nessuna' }, normForMatch(soloScheda), soloScheda), false, 'parola assente dal testo')
  // citazione che contiene la parola ma con parole che la pagina non ha: no
  assert.equal(passesStagedEvidence(franchigiaMed, 'NESSUNA', { evidenza: 'Franchigia prevista: NESSUNA' }, normForMatch(lucca), lucca), false)
  // senza citazione (chiave omessa, facoltativa fuori dalle verifiche): resta la parola nel testo
  assert.equal(passesStagedEvidence(franchigiaMed, 'NESSUNA', {}, normForMatch(lucca), lucca), true)
  assert.equal(passesStagedEvidence(est, 'Nessuna', {}, normForMatch(soloScheda), soloScheda), false)
  // "Riporta 'Sì' se la polizza prevede tacito rinnovo" (CSA RC Professionale):
  // una risposta cortissima senza citazione non passa mai (come prima)
  const tacito = { id: 't', label: 'Tacito rinnovo', description: "Riporta 'Sì' se la polizza prevede tacito rinnovo e 'No' se è senza tacito rinnovo, solo quando il dato è espresso o chiaramente stabilito dal contratto." }
  assert.equal(isPrescribedAnswer(tacito, 'Sì'), true)
  const rinnovo = '[Documento 1 · pag. 1]\nLa polizza si rinnova tacitamente di anno in anno.'
  assert.equal(passesStagedEvidence(tacito, 'Sì', {}, normForMatch(rinnovo), rinnovo), false)
  assert.equal(passesStagedEvidence(tacito, 'Sì', { evidenza: 'La polizza si rinnova tacitamente di anno in anno.' }, normForMatch(rinnovo), rinnovo), true)
})

test('descriptionEchoPhrase: "Non operante" delle Condizioni nelle Esclusioni, assente dal testo, è un eco', () => {
  const escl = byLabel(RC, 'Esclusioni particolari')
  const cond = byLabel(RC, 'Condizioni particolari')
  // RCP SAPORITI: "non" e "operante" stanno nel testo, "Non operante" no
  const ctx = normForMatch('La copertura assicurativa non si applica alle Richieste di risarcimento. La garanzia è operante a condizione che l’Assicurato sia iscritto.')
  assert.equal(descriptionEchoPhrase(escl, 'Non operante', [escl, cond], ctx), 'Non operante')
  // se la scheda lo stampa (GUFFANTI RC 2026 pag. 6) non è un eco
  assert.equal(descriptionEchoPhrase(escl, 'Non operante', [escl, cond], normForMatch(GUFFANTI_P6)), null)
  // la descrizione del campo stesso non conta (lì decide la risposta prescritta)
  assert.equal(descriptionEchoPhrase(cond, 'Non operante', [escl, cond], ctx), null)
  assert.equal(descriptionEchoPhrase(escl, 'Non operante', [escl], ctx), null, 'campo non chiesto nella stessa chiamata')
})

test('descriptionEchoPhrase: la risposta che la PROPRIA descrizione prescrive non è l\'eco di un altro campo (RC PROF MED V2)', () => {
  const franchigia = byLabel(MED, 'Franchigia base')
  // il Frazionamento vero (l'ultimo campo) cita 'NESSUNA' nel suo "MAI … né 'NESSUNA'"
  const frazionamento = MED.find((f) => /^Frazionamento del premio/.test(String(f.description || '')))
  assert.ok(franchigia && frazionamento)
  const ctx = normForMatch('FRANCHIGIA PER SINISTRO     FRAZIONAMENTO\n-                           ANNUALE')
  assert.equal(descriptionEchoPhrase(franchigia, 'NESSUNA', [franchigia, frazionamento], ctx), null)
  // l'eco resta tale sul campo che NON la prevede: "NESSUNA" nel Frazionamento
  assert.equal(descriptionEchoPhrase(frazionamento, 'NESSUNA', [franchigia, frazionamento], ctx), 'NESSUNA')
})

test('absorbStagedEntries: risposta di verifica che non nomina l\'oggetto scartata, citazione nel log; eco scartato', async () => {
  const fields = [byLabel(RC, 'Visto leggero'), byLabel(RC, 'Attività giudiziale / stragiudiziale'), byLabel(RC, 'Esclusioni particolari'), byLabel(RC, 'Condizioni particolari')]
  // RCP PILATO pag. 4 (griglia) + una pagina con "non" e "operante" separati
  const ctx = [
    '[Documento 1 · pag. 4]',
    "                                    a) attività di rappresentanza e difesa dinanzi all'autorità giudiziaria o ad arbitri, tanto rituali quanto",
    '            B.  Consulenza Fiscale  La Società si obbliga a tenere indenne l’ Assicurato da ogni somma che questi sia tenuto a pagare o a',
    '[Documento 1 · pag. 9]',
    'La copertura assicurativa non si applica alle Richieste di risarcimento. La garanzia è operante a condizione che l’Assicurato sia iscritto.',
  ].join('\n')
  const parsed = {
    c0: { valore: 'presente', evidenza: 'B.  Consulenza Fiscale  La Società si obbliga a tenere indenne l’ Assicurato' },
    c1: { valore: 'Sì', evidenza: "a) attività di rappresentanza e difesa dinanzi all'autorità giudiziaria o ad arbitri" },
    c2: { valore: 'Non operante', evidenza: '' },
  }
  const best = {}
  const counters = { unknown: 0, sanitized: 0, placeholders: 0, noEvidence: 0, guardrail: 0 }
  const report = []
  const objects = verificationObjectsByField(RC)
  await absorbStagedEntries(parsed, fields, best, {}, [], normForMatch(ctx), new Set(), counters, report, null, null, null, null, ctx, objects)
  const outcome = (f) => report.filter((r) => r.id === f.id && r.outcome !== 'chiave-corretta').map((r) => r.outcome)
  assert.deepEqual(outcome(fields[0]), ['evidenza:non-nomina-oggetto'])
  assert.match(report.find((r) => r.outcome === 'evidenza:non-nomina-oggetto').ev, /^B\. Consulenza Fiscale La Società/)
  assert.deepEqual(outcome(fields[1]), ['ok'])
  assert.deepEqual(outcome(fields[2]), ['eco-descrizione'])
  assert.equal(best[fields[1].id]?.valore, 'Sì')
  assert.equal(fields[0].id in best, false)
  assert.equal(fields[2].id in best, false)
  // la citazione registrata è tagliata a 120 caratteri
  const lungo = { c0: { valore: 'presente', evidenza: 'B.  Consulenza Fiscale  La Società si obbliga a tenere indenne l’ Assicurato da ogni somma che questi sia tenuto a pagare o a' } }
  const rep2 = []
  await absorbStagedEntries(lungo, fields, {}, {}, [], normForMatch(ctx), new Set(), { ...counters }, rep2, null, null, null, null, ctx, objects)
  assert.ok(rep2.find((r) => r.outcome === 'evidenza:non-nomina-oggetto').ev.length <= 120)
  // senza mappa degli oggetti (chiamanti storici) il controllo non si applica
  const rep3 = []
  await absorbStagedEntries({ c0: parsed.c0 }, fields, {}, {}, [], normForMatch(ctx), new Set(), { ...counters }, rep3, null, null, null, null, ctx)
  assert.ok(rep3.some((r) => r.outcome === 'ok'))
})

test('paraphraseHint: "anche con parole diverse" tolto per i campi di verifica (cascata e recupero)', () => {
  const visto = byLabel(RC, 'Visto leggero')
  const premio = byLabel(RC, 'Premio lordo')
  assert.equal(paraphraseHint([premio]), 'anche con parole diverse', 'prompt invariato senza verifiche')
  assert.doesNotMatch(paraphraseHint([visto]), /parole diverse/)
  assert.match(paraphraseHint([premio, visto]), /TRANNE per i campi che chiedono di VERIFICARE/)
})
