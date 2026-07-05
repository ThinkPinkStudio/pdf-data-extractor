/**
 * Test del parser metadati dal percorso di upload (archivio polizze del cliente).
 *
 * Esegui:  node --test
 *
 * I percorsi sono ricostruiti dagli screenshot reali dello share \\ts-main
 * (archivio polizze Z:), inclusi i casi devianti: upload a profondità diverse,
 * cartelle amministrative di rumore, persone fisiche senza "Gruppo".
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { parseDocumentPath, classifyFileName, normalizeSegment } from '../src/main/services/pathMetadata.js'

// ─── Percorso canonico completo (Area Storica) ───────────────────────────────

test('percorso canonico Area Storica: tutti i campi', () => {
  const m = parseDocumentPath(
    'in vigore/Area Storica/in vigore/Gruppo Adamant Bionrg/In vigore/Adamant Bionrg/in uso/Multirischi/Convenzione sostituita da Full/Quietanza di rinnovo 2023.pdf'
  )
  assert.equal(m.agenzia, 'Area Storica')
  assert.equal(m.gruppo, 'Gruppo Adamant Bionrg')
  assert.equal(m.societa, 'Adamant Bionrg')
  assert.equal(m.statoVigore, 'in vigore')
  assert.equal(m.uso, 'in uso')
  assert.equal(m.ramo, 'Multirischi')
  assert.equal(m.docType, 'quietanza')
  assert.equal(m.anno, 2023)
})

test('upload che parte dal gruppo (profondità ridotta)', () => {
  const m = parseDocumentPath('Gruppo Adamant Bionrg/In vigore/Adamant Bionrg/in uso/D&O/questionario AIG. firmato.pdf')
  assert.equal(m.agenzia, null)
  assert.equal(m.gruppo, 'Gruppo Adamant Bionrg')
  assert.equal(m.societa, 'Adamant Bionrg')
  assert.equal(m.ramo, 'D&O')
  assert.equal(m.docType, 'questionario')
})

test('non in vigore dentro il gruppo vince sulla radice', () => {
  const m = parseDocumentPath('in vigore/Area Storica/in vigore/Gruppo Xanthos/non in vigore/Xanthos/in uso/Auto/polizza.pdf')
  assert.equal(m.statoVigore, 'non in vigore')
  assert.equal(m.ramo, 'Auto')
  assert.equal(m.docType, 'polizza')
})

// ─── CSA Lipari: persone fisiche e rumore amministrativo ─────────────────────

test('persona fisica senza Gruppo (CSA Lipari)', () => {
  const m = parseDocumentPath('in vigore/CSA Lipari/In vigore/Ascheri Stefano/RCA/Quietanza di rinnovo 2025.pdf')
  assert.equal(m.agenzia, 'CSA Lipari')
  assert.equal(m.gruppo, null)
  assert.equal(m.societa, 'Ascheri Stefano')
  assert.equal(m.ramo, 'RCA')
  assert.equal(m.docType, 'quietanza')
  assert.equal(m.anno, 2025)
})

test('cartelle amministrative ignorate, non diventano società', () => {
  const m = parseDocumentPath('CSA Lipari/QUIETANZAMENTO APRILE 2026/elenco.pdf')
  assert.equal(m.agenzia, 'CSA Lipari')
  assert.equal(m.societa, null)
  assert.equal(m.ramo, null)
})

test('DA CANCELLARE e Contabilità sono rumore', () => {
  for (const noise of ['DA CANCELLARE', 'Contabilità Generale', 'SCATOLONI PER TORTONA', "Archivio Morto  Contabilita'"]) {
    const m = parseDocumentPath(`CSA Lipari/${noise}/doc.pdf`)
    assert.equal(m.societa, null, `"${noise}" non deve diventare società`)
  }
})

test('gruppo con società multiple: prende quella nel percorso', () => {
  const m = parseDocumentPath('CSA Lipari/In vigore/Gruppo Allianz-Barbieri/Milano Fashion Institute/Incendio/polizza 2024.pdf')
  assert.equal(m.gruppo, 'Gruppo Allianz-Barbieri')
  assert.equal(m.societa, 'Milano Fashion Institute')
  assert.equal(m.ramo, 'Incendio')
  assert.equal(m.anno, 2024)
})

// ─── Rami: alias e varianti ──────────────────────────────────────────────────

test('alias rami: RCTOP, RCT/O, Incendio Banca, Vita Dirigenti, Tutela legale estesa', () => {
  assert.equal(parseDocumentPath('x/RCTOP/a.pdf').ramo, 'RCTOP')
  assert.equal(parseDocumentPath('x/RCT_O/a.pdf').ramo, 'RCTO')
  assert.equal(parseDocumentPath('x/Incendio Banca/a.pdf').ramo, 'Incendio')
  assert.equal(parseDocumentPath('x/Vita Dirigenti/a.pdf').ramo, 'Vita')
  assert.equal(parseDocumentPath('x/Tutela legale/Tutela legale quadri dirigenti/a.pdf').ramo, 'Tutela legale')
  assert.equal(parseDocumentPath('x/Infortuni Amministratori/a.pdf').ramo, 'Infortuni')
  assert.equal(parseDocumentPath('x/RSM Gravi Patologie/a.pdf').ramo, 'RSM')
})

test('il primo ramo trovato vince (sottocartella non lo sovrascrive)', () => {
  const m = parseDocumentPath('soc/in uso/Multirischi/Incendio Banca/polizza.pdf')
  assert.equal(m.ramo, 'Multirischi')
})

// ─── Nomi file ───────────────────────────────────────────────────────────────

test('classificazione nomi file reali', () => {
  assert.deepEqual(classifyFileName('Quietanza di rinnovo 2021.pdf'), { docType: 'quietanza', anno: 2021 })
  assert.equal(classifyFileName('App.4 signed.pdf').docType, 'appendice')
  assert.equal(classifyFileName('App.6 nuova ubicazione.pdf').docType, 'appendice')
  assert.equal(classifyFileName('Certificato CSA 171.pdf').docType, 'certificato')
  assert.equal(classifyFileName('questionario AIG del 05.07.19 non firmato.pdf').docType, 'questionario')
  assert.equal(classifyFileName('Bilancio + Nota Integrativa al 31.12.2018 Adamant Bionrg Srl.pdf').docType, 'bilancio')
  assert.equal(classifyFileName('Relazione sulla gestione 2018 Adamant Bionrg srl.pdf').docType, 'bilancio')
  assert.equal(classifyFileName('Bio Polizza 2024.pdf').docType, 'polizza')
  assert.equal(classifyFileName('Set Informativo_DAS IN AZIENZA.pdf').docType, 'set_informativo')
  assert.equal(classifyFileName('GRANDI GUIDO_2024_535584589.pdf').docType, 'altro')
  assert.equal(classifyFileName('GRANDI GUIDO_2024_535584589.pdf').anno, 2024)
})

test('solo nome file, nessuna cartella', () => {
  const m = parseDocumentPath('Quietanza di rinnovo 2024.pdf')
  assert.equal(m.docType, 'quietanza')
  assert.equal(m.anno, 2024)
  assert.equal(m.societa, null)
  assert.equal(m.gruppo, null)
})

test('normalizeSegment: accenti, punti, maiuscole', () => {
  assert.equal(normalizeSegment('Contabilità  Générale'), 'contabilita generale')
  assert.equal(normalizeSegment('RCT_O'), 'rct o')
})
