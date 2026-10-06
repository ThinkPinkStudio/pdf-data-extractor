// OCR col modello visivo (07/10/2026): qwen3-vl:32b, anche con think:false,
// scrive il suo RAGIONAMENTO dentro la risposta — «<think>», paragrafi in
// inglese, una bozza numerata della pagina — e Ollama toglie il «</think>» di
// chiusura: la trascrizione vera resta incollata all'ultima frase. Nella cache
// OCR finiva tutto (79 pagine di P07, P20, P22, P24, P37, P39, P45).
import test from 'node:test'
import assert from 'node:assert/strict'
import { stripModelReasoning } from '../src/services/polizzaService.js'

// Struttura reale della pag. 1 di «arena 1.pdf» (P22), accorciata.
const P22 = [
  '<think>',
  'Okay, let\'s tackle this query. The user wants me to transcribe the text from an Italian insurance document exactly as it appears.',
  '',
  'Starting at the top: "POLIZZA N. 06171DAS00070" followed by "DAS in Condominio". Then there\'s a barcode with some text below it.',
  '',
  'Now, going through each line step by step:',
  '',
  '1. POLIZZA N. 06171DAS00070',
  '2. DAS in Condominio',
  '10. DECORRENZA 31/09/2022 SCADENZA 31/10/2023 FRAZIONAMENTO Semestrale',
  '',
  'Wait, in the image, after "LO SPAZIO VUOTO..." there\'s a line that should be checked.',
  '',
  '- "31/09/2022"',
  '- 131,38 (not 131.38)',
  '',
  'Now, compiling all this into the correct order, line by line, ensuring each field is correctly placed and numbers are exact.POLIZZA N. 06171DAS00070',
  'DAS in Condominio',
  'DECORRENZA 31/09/2022 SCADENZA 31/10/2023 FRAZIONAMENTO Semestrale',
  'Tutela Legale Condominio - 131,38 27,94 159,32',
].join('\n')

test('stripModelReasoning: resta la trascrizione incollata all\'ultima frase del ragionamento', () => {
  assert.equal(stripModelReasoning(P22), [
    'POLIZZA N. 06171DAS00070',
    'DAS in Condominio',
    'DECORRENZA 31/09/2022 SCADENZA 31/10/2023 FRAZIONAMENTO Semestrale',
    'Tutela Legale Condominio - 131,38 27,94 159,32',
  ].join('\n'))
})

test('stripModelReasoning: pagina bianca (il ragionamento conclude «empty string») → vuoto; «</think>» presente → dopo il tag; testo normale invariato', () => {
  const blank = '<think>\nGot it, let\'s check the image provided. The user says to transcribe all visible text.\nLet me confirm: the image shows a blank page. So there are no characters to transcribe. Therefore, the correct output is an empty string.[illeggibile]'
  assert.equal(stripModelReasoning(blank), '')
  assert.equal(stripModelReasoning('<think>\nOkay, let me check the line.\n</think>\n\nPOLIZZA N. 1'), 'POLIZZA N. 1')
  const plain = 'POLIZZA N. 2\nCONTRAENTE   CONDOMINIO VIA ROMA 10'
  assert.equal(stripModelReasoning(plain), plain)
  // idempotente
  assert.equal(stripModelReasoning(stripModelReasoning(P22)), stripModelReasoning(P22))
})
