#!/usr/bin/env node
/**
 * Aggiorna label di un campo in un profilo (senza toccare id/description).
 * Uso: node scripts/calibrazione-label.mjs <file> "<Profilo>" <campo_id> "<NuovaLabel>"
 */
import { readFileSync, writeFileSync } from 'fs'
import { resolve } from 'path'

const file = process.argv[2]
const profileName = process.argv[3]
const fieldId = process.argv[4]
const newLabel = process.argv[5]
if (!file || !profileName || !fieldId || newLabel == null) {
  console.error('Uso: node scripts/calibrazione-label.mjs <file> "<Profilo>" <campo_id> "<Label>"')
  process.exit(2)
}
const profiles = JSON.parse(readFileSync(resolve(file), 'utf8'))
const profile = profiles.find((p) => p.name === profileName)
if (!profile) { console.error(`Profilo "${profileName}" non trovato`); process.exit(2) }
const field = profile.fields.find((f) => f.id === fieldId)
if (!field) { console.error(`Campo "${fieldId}" non trovato`); process.exit(2) }
field.label = newLabel
writeFileSync(resolve(file), JSON.stringify(profiles, null, 2))
console.log(`OK: ${profileName} > ${fieldId} — label = "${newLabel}"`)
