/**
 * Albero di cartelle dello ZIP "scarica tutti i PDF" di un batch.
 *
 * Esegui:  node --test test/polizzaBatchZip.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  batchZipFileName,
  planBatchZip,
  sanitizeSegment,
  uniqueZipPath,
  zipEntryPath,
} from '../web/lib/polizzaBatchZip.js'

test('col percorso relativo si riproduce l\'albero di origine, radice compresa', () => {
  assert.equal(
    zipEntryPath({
      batchLabel: 'GUFFANTI GROUP',
      dossierName: 'GUFFANTI GROUP/Tutela Legale',
      relPath: 'GUFFANTI GROUP/Tutela Legale/Scansioni/polizza.pdf',
      fileName: 'polizza.pdf',
    }),
    'GUFFANTI GROUP/Tutela Legale/Scansioni/polizza.pdf'
  )
})

test('senza percorso relativo (file caricati prima della migrazione) vale il nome del dossier', () => {
  assert.equal(
    zipEntryPath({ batchLabel: 'GUFFANTI GROUP', dossierName: 'GUFFANTI GROUP/Polizza 1', relPath: null, fileName: 'quietanza.pdf' }),
    'GUFFANTI GROUP/Polizza 1/quietanza.pdf'
  )
})

test('la radice del batch non viene mai raddoppiata né persa', () => {
  // Il nome del dossier comincia già con la radice: nessun doppione.
  assert.equal(
    zipEntryPath({ batchLabel: 'Clienti', dossierName: 'Clienti/Rossi', fileName: 'a.pdf' }),
    'Clienti/Rossi/a.pdf'
  )
  // Dossier senza radice davanti: viene comunque messa, così si estrae tutto in
  // una cartella sola.
  assert.equal(
    zipEntryPath({ batchLabel: 'Clienti', dossierName: 'Rossi', fileName: 'a.pdf' }),
    'Clienti/Rossi/a.pdf'
  )
  // File sciolto, senza alcuna cartella.
  assert.equal(
    zipEntryPath({ batchLabel: 'Clienti', dossierName: '', fileName: 'a.pdf' }),
    'Clienti/a.pdf'
  )
})

test('i percorsi non possono uscire dalla cartella radice', () => {
  assert.equal(
    zipEntryPath({ batchLabel: 'Clienti', relPath: '../../etc/passwd', fileName: 'passwd' }),
    'Clienti/etc/passwd'
  )
  assert.equal(
    zipEntryPath({ batchLabel: 'Clienti', relPath: '/tmp/evil.pdf', fileName: 'evil.pdf' }),
    'Clienti/tmp/evil.pdf'
  )
  assert.equal(sanitizeSegment('a/b:c*d?'), 'a_b_c_d_')
  assert.equal(sanitizeSegment('cartella.'), 'cartella') // Windows rifiuta il punto finale
  assert.equal(sanitizeSegment('   '), '_')
})

test('due file omonimi nella stessa cartella non si sovrascrivono', () => {
  const used = new Set()
  assert.equal(uniqueZipPath('A/doc.pdf', used), 'A/doc.pdf')
  assert.equal(uniqueZipPath('A/doc.pdf', used), 'A/doc (2).pdf')
  assert.equal(uniqueZipPath('A/DOC.pdf', used), 'A/DOC (3).pdf') // case-insensitive: Windows/macOS
  assert.equal(uniqueZipPath('B/doc.pdf', used), 'B/doc.pdf')
})

test('planBatchZip assegna un percorso a ogni file mantenendo l\'ordine', () => {
  const plan = planBatchZip('EULIP', [
    { jobId: 'j1', filesJobId: 'j1', dossierName: 'EULIP/Polizza', idx: 0, fileName: 'contratto.pdf', relPath: 'EULIP/Polizza/contratto.pdf' },
    { jobId: 'j1', filesJobId: 'j1', dossierName: 'EULIP/Polizza', idx: 1, fileName: 'contratto.pdf', relPath: null },
    { jobId: 'j2', filesJobId: 'j2', dossierName: 'EULIP/Quietanze', idx: 0, fileName: 'q2025.pdf', relPath: null },
  ])
  assert.deepEqual(plan.map((p) => p.path), [
    'EULIP/Polizza/contratto.pdf',
    'EULIP/Polizza/contratto (2).pdf',
    'EULIP/Quietanze/q2025.pdf',
  ])
  // I metadati per leggere il PDF restano attaccati alla voce.
  assert.equal(plan[2].filesJobId, 'j2')
  assert.equal(plan[2].idx, 0)
})

test('il nome dell\'archivio è l\'etichetta del batch ripulita', () => {
  assert.equal(batchZipFileName('GUFFANTI GROUP'), 'GUFFANTI_GROUP_pdf.zip')
  assert.equal(batchZipFileName('Clienti/2025 – "vari"'), 'Clienti_2025_vari_pdf.zip')
  assert.equal(batchZipFileName(''), 'batch_pdf.zip')
})
