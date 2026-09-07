#!/usr/bin/env node
/**
 * Helper di calibrazione: applica modifiche puntuali alle descrizioni dei campi
 * di un profilo specifico nel JSON dei profili, salvando su un file di lavoro.
 *
 * Uso:
 *   node scripts/calibrazione-patch.mjs <file-profilo.json> "<NomeProfilo>" <campo_id> <nuovaDescrizione>
 *
 * Con --list "<NomeProfilo>" stampa l'elenco campi del profilo.
 */
import { readFileSync, writeFileSync } from 'fs'
import { resolve } from 'path'

const args = process.argv.slice(2)
function val(flag) {
  const i = args.indexOf(flag)
  return i === -1 ? null : args[i + 1]
}

const file = args[0]
const profileName = args[1]
if (!file || !profileName) { console.error('Uso: node scripts/calibrazione-patch.mjs <file> "<Profilo>" <campo_id> <desc>  |  --list "<Profilo>" <file>'); process.exit(2) }

const profiles = JSON.parse(readFileSync(resolve(file), 'utf8'))
const profile = profiles.find((p) => p.name === profileName)
if (!profile) { console.error(`Profilo "${profileName}" non trovato`); process.exit(2) }

if (args[2] === '--list') {
  for (const f of profile.fields) console.log(`${f.enabled !== false ? '' : '(off) '}${f.id}\t${f.label}`)
  process.exit(0)
}

const fieldId = args[2]
const desc = args[3]
if (!fieldId || desc == null) { console.error('Manca campo_id o descrizione'); process.exit(2) }
const field = profile.fields.find((f) => f.id === fieldId)
if (!field) { console.error(`Campo "${fieldId}" non trovato nel profilo ${profileName}`); process.exit(2) }
field.description = desc
writeFileSync(resolve(file), JSON.stringify(profiles, null, 2))
console.log(`OK: ${profileName} > ${fieldId} — descrizione aggiornata.`)
