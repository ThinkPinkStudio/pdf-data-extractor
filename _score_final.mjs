#!/usr/bin/env node
// Score dei risultati VERIFICA DEFINITIVA vs attesi (golden orientativi).
// Uso: node _score_final.mjs
import { readFileSync } from 'fs'

const MAP = {
  'out/_final_B.json': {
    name: 'B', golden: {
      polizza_numero: 'RCM00010027822', compagnia: 'AmTrust', contraente: 'MAURO CARLO NEBULONI',
      codice_fiscale_iva: 'NBLMCR58L23D0033D', indirizzo: 'ABBIATEGRASSO',
      decorrenza: '14/10/2021', scadenza: '14/10/2025', rcp_imposta: 'Sì', rcp_premio_totale: '3.499,00',
      rcp_premio_imponibile: 'Annuale', rct_massimale_sinistro: '2.000.000,00', rct_massimale_persona: '6.000.000,00',
      rct_massimale_danni: '10.000,00', rct_massimale_prestatore: 'non indicato', rct_parametro: '200.000', rct_importo_preventivo: 'radiodiagnostica',
      'c125c0d1-695b-4755-81db-e99137169686': 'non indicato', '89ffb116-bf3b-4bcb-a6bb-7ceeed04cfee': '14/10/2014',
      '6e39add8-de2c-4d48-b231-f03cd4e05bd5': '1 sinistro',
    },
  },
  'out/_final_ODON.json': {
    name: 'ODON', golden: {
      polizza_numero: 'QZ036934162XP', compagnia: 'Sara', rct_massimale_sinistro: 'non 0',
      rcp_premio_totale: 'sensato', scadenza: '31/12/2026', decorrenza: '31/12/2025',
    },
  },
  'out/_final_PROF.json': {
    name: 'PROF', golden: {
      polizza_numero: 'RIF', compagnia: 'Sara', contraente: 'sanitaria',
      rcp_premio_totale: 'non 25', rct_massimale_sinistro: '1.000.000', rct_massimale_persona: 'trattenuta',
    },
  },
  'out/_final_CEDAM.json': {
    name: 'CEDAM', golden: {
      polizza_numero: '781949596', compagnia: 'UnipolSai', contraente: 'CEDAM',
      codice_fiscale_iva: '00587800137', indirizzo: 'VIA CERVA 22', scadenza: '31/12/2026',
      rcp_premio_totale: '13.068,01', rct_massimale_sinistro: '7.500.000,00', rct_massimale_persona: '7.500.000,00',
      rct_massimale_prestatore: 'non 7.500.000', rcp_massimale_sinistro: 'non 7.500.000', rcp_massimale_annuo: 'non 7.500.000',
      rcp_massimale_mat: 'non 7.500.000', rcp_massimale_interr: 'non 7.500.000', rcp_scoperto_min_mondo: 'non 7.500.000',
      rcp_scoperto_max_mondo: 'non 7.500.000', rcp_scoperto_min_usa: 'non 7.500.000',
      fatturato: '8.045.000',
    },
  },
}

let totalOk = 0, totalN = 0
for (const [path, spec] of Object.entries(MAP)) {
  let j
  try { j = JSON.parse(readFileSync(path, 'utf8')) } catch (e) { console.log(`\n== ${spec.name}: file non ancora pronto`); continue }
  const d = j.data || {}
  console.log(`\n== ${spec.name} — ${j.secs}s`)
  for (const [k, atteso] of Object.entries(spec.golden)) {
    const reale = d[k]
    const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim()
    let ok
    if (atteso === 'non 0') ok = parseFloat(String(reale).replace(/\./g, '').replace(',', '.')) > 0
    else if (atteso === 'sensato') ok = reale != null && reale !== ''
    else if (atteso === 'trattenuta') ok = reale != null && reale !== '' && parseFloat(String(reale).replace(/\./g, '').replace(',', '.')) > 0
    else if (atteso.startsWith('non ')) ok = !norm(reale).includes(atteso.slice(4).toLowerCase())
    else ok = norm(reale).includes(atteso.toLowerCase())
    totalN++ ; if (ok) totalOk++
    console.log(`  [${ok ? 'OK ' : 'NO '}] ${k} atteso="${atteso}" reale=${JSON.stringify(reale)}`)
  }
}
console.log(`\nTOTALE: ${totalOk}/${totalN}`)