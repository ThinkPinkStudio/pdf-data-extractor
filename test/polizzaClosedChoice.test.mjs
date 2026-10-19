// [flag sceltaprova] Campi a scelta chiusa («una tra …»): la prova è la
// citazione del modello nel testo, come per le verifiche (Lipari 19/10/2026).
import test from 'node:test'
import assert from 'node:assert/strict'
import { closedChoiceHasEvidence } from '../src/services/polizzaService.js'
import { normForMatch } from '../src/services/polizzaValidation.js'
import { KNOWN_FLAGS } from '../src/services/engineFlags.js'

const field = { id: 't', label: 'X', description: 'Tipologia della copertura: la categoria del rischio, una tra Azienda, Professionista/Studio professionale, Auto/Circolazione, Condominio, Altra tipologia (es. Condominio).' }
const raw = '[Documento 1 · pag. 1]\nVeicolo: AUTOVETTURA   Targa: FC 977 GP\nGARANZIA RCA   Tutela legale   € 20.000   € 17,17'
const norm = normForMatch(raw)

test('sceltaprova: opzione della descrizione con citazione presente nel testo', () => {
  assert.equal(closedChoiceHasEvidence(field, 'Auto/Circolazione', 'Veicolo: AUTOVETTURA', norm, raw), true)
})
test('sceltaprova: niente citazione, citazione inventata o valore fuori elenco = nessuna prova', () => {
  assert.equal(closedChoiceHasEvidence(field, 'Auto/Circolazione', '', norm, raw), false)
  assert.equal(closedChoiceHasEvidence(field, 'Auto/Circolazione', 'Veicolo: MOTOCICLO da corsa', norm, raw), false)
  assert.equal(closedChoiceHasEvidence(field, 'Veicoli', 'Veicolo: AUTOVETTURA', norm, raw), false)
  assert.equal(closedChoiceHasEvidence({ ...field, description: 'Testo libero del rischio.' }, 'Auto/Circolazione', 'Veicolo: AUTOVETTURA', norm, raw), false)
  for (const f of ['sceltaprova', 'separatori', 'piattoovunque']) assert.ok(f in KNOWN_FLAGS)
})
