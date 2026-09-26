#!/usr/bin/env node
// Riscrive le descrizioni dei campi del profilo "Tutela Legale 3" come
// descrizioni del TIPO DI DATO (cosa è, formato, esempi, cosa NON è), MAI
// come istruzioni su dove trovarlo nel documento (colonne/righe/layout che
// cambiano da polizza a polizza).
import { readFileSync, writeFileSync } from 'fs'

const path = 'polizze_test/profili-polizza-calibrato.json'
const profiles = JSON.parse(readFileSync(path, 'utf8'))
const tl = profiles.find((x) => x.name === 'Tutela Legale 3')
if (!tl) { console.error('profilo non trovato'); process.exit(1) }

// label → nuova descrizione (sul TIPO di dato, mai sul layout)
const NEW_DESC = {
  'N° Polizza':
    'Numero identificativo della polizza: una sequenza di cifre (con eventuali prefissi o suffissi alfanumerici) che identifica il contratto. Esempi: 410000880, 0146905092, BL05000049. NON è il nome del fabbricato/condominio né la descrizione del rischio.',
  'Indirizzo':
    'Indirizzo completo di domicilio o sede legale del contraente/assicurato: via, numero civico, CAP, città (es. VIA LAMBRATE 3, 20131 MILANO). È l\'indirizzo della persona/azienda assicurata, NON quello della compagnia assicuratrice né dell\'agenzia né del legale.',
  'Massimale per sinistro tutela legale':
    'Massimale per sinistro: l\'importo massimo (in euro) che la compagnia paga per ogni singolo sinistro/evento coperto dalla garanzia tutela legale. È un importo, spesso con migliaia (es. 20.000, 21.000,00, 4.000.000,00). Se il documento riporta più importi, scegli quello associato al singolo sinistro/evento, non quello annuale né il premio.',
  'Massimale per anno tutela legale':
    'Massimale per anno: l\'importo massimo (in euro) che la compagnia paga complessivamente in un anno per tutti i sinistri coperti dalla garanzia tutela legale. È un importo (es. 40.000,00) oppure la parola "Illimitato"/"ILLIMITATO" quando non c\'è limite. NON è il massimale per singolo sinistro né il premio.',
  'Interessi di frazionamento':
    'Interessi di frazionamento del premio: l\'importo (in euro) aggiunto al premio quando il pagamento è rateizzato (es. 0,00 se non ci sono interessi, 2,48). È un importo con due decimali. Se il valore è zero riporta "0,00". NON è il premio, né l\'imponibile, né i diritti.',
  'Premio lordo totale tutela legale':
    'Premio lordo totale annuo della garanzia tutela legale: l\'importo complessivo (in euro) che il contraente paga, comprensivo di imposte e accessori (es. 5.184,00, 255,00). È l\'importo TOTALE, non una rata né il solo imponibile. Se nel documento compaiono più importi (rata iniziale, rata successiva, totale annuo), scegli quello che rappresenta il totale del periodo di copertura.',
  'Decorrenza':
    'Data di decorrenza della polizza: la data (giorno/mese/anno) da cui inizia la copertura assicurativa (es. 04/06/2025, 27/04/2020). È la data di INIZIO del periodo di copertura, non la data di emissione del documento né la data di scadenza.',
  'Scadenza':
    'Data di scadenza della polizza: la data (giorno/mese/anno) in cui termina la copertura assicurativa (es. 31/12/2022, 30/09/2021). È la data di FINE del periodo di copertura, non la data di emissione né la decorrenza.',
  'Frazionamento':
    'Frazionamento del premio: la periodicità di pagamento del premio, come TESTO (es. Annuale, Semestrale, Trimestrale, Mensile). Riporta la parola per intero (es. "Annuale", non "Annua" o "Ann"). NON è una data né un importo.',
  'Attività assicurata':
    'Attività assicurata: il settore o tipo di attività del contraente/assicurato che è oggetto della copertura (es. Servizi vari, Professionista/Studio associato, Condominio, Difesa Condominio). È un TESTO che descrive l\'attività, non un importo né una data.',
  'Parametro regolazione ':
    'Parametro utilizzato per la regolazione del premio: il NOME del parametro come TESTO (es. Retribuzioni, Fatturato, n. addetti, numero degli addetti e/o del fatturato annuo). NON è l\'importo del parametro (quello va nel campo "Importo preventivo parametro regolazione") né un tasso.',
  'Tasso regolazione ‰ ':
    'Tasso di regolazione: il tasso espresso per mille (‰) applicato al parametro di regolazione (es. 0,245, 44,16). È un numero, tipicamente con virgola decimale. Se la polizza non riporta un tasso di regolazione, lascia il campo vuoto.',
  'Premio imponibile tutela legale':
    'Premio imponibile della garanzia tutela legale: l\'importo (in euro) del premio al netto di imposte e accessori, cioè la base imponibile (es. 1.200,00, 207,83, 501,30). È un importo con due decimali. NON è il premio lordo (che include imposte) né i diritti né gli interessi.',
  'Diritti':
    'Diritti del premio: l\'importo (in euro) dei diritti di emissione/agenzia aggiunti al premio (es. 0,00, 19,30, 251,99). È un importo con due decimali. Se il valore è zero riporta "0,00". NON è il premio, né l\'imponibile, né le imposte.',
  'Imposte':
    'Imposte sul premio: l\'importo (in euro) delle imposte (es. IVA o imposta sulle assicurazioni) applicate al premio della garanzia tutela legale (es. 269,90, 19,30, 44,16). È un importo con due decimali. NON è il premio lordo né l\'imponibile né i diritti.',
  'Garanzie scelte/operanti':
    'Elenco dei nomi delle garanzie scelte/operanti (attive) nella polizza: un TESTO con i nomi delle coperture (es. Tutela Legale, Tutela Legale Pacchetto Base, Anticipo spese penale doloso, Controversie nei confronti di DAS). Riporta i nomi delle garanzie ATTIVE, non gli importi né le date.',
  'Garanzie non operanti':
    'Elenco dei nomi delle garanzie NON attivate/operanti (escluse) nella polizza: un TESTO con i nomi delle coperture non scelte (es. Pacchetto difesa circolazione, Condominio). Riporta SOLO le garanzie non attive, non le informazioni aggiuntive né i massimali.',
  'Importo preventivo parametro regolazione':
    'Importo preventivo annuo del parametro di regolazione: l\'importo (in euro) dichiarato come base per la regolazione del premio (es. 240.000.000,00, 1.800.000). È un importo, tipicamente grande. NON è il premio né il tasso di regolazione.',
  'Franchigia generica o minima':
    'Franchigia generica o minima della polizza: l\'importo (in euro) che resta a carico dell\'assicurato per ogni sinistro, indicato esplicitamente come franchigia (es. 200,00, 21.000,00). È un importo con due decimali. NON sono franchigie i limiti tipo "anticipo spese penale doloso 5.000 euro" né i massimali né i premi. Se il documento non indica una franchigia, lascia il campo vuoto.',
  'Tipologia tutela legale':
    'Tipologia di bisogni assicurativi coperti dalla tutela legale: un TESTO che elenca gli ambiti di copertura (es. Tutela mobilità/circolazione, Tutela vita privata, Tutela attività professionale, Tutela imprese o ente, Tutela manager). Riporta gli ambiti indicati nel documento come coperti.',
}

let changed = 0
for (const f of tl.fields) {
  const key = Object.keys(NEW_DESC).find((k) => k.trim() === f.label.trim())
  if (key && f.description !== NEW_DESC[key]) {
    f.description = NEW_DESC[key]
    changed++
    console.log(`  aggiornato: ${f.label}`)
  }
}
if (changed) {
  writeFileSync(path, JSON.stringify(profiles, null, 2) + '\n', 'utf8')
  console.log(`\n${changed} descrizioni aggiornate in ${path}`)
} else {
  console.log('nessuna descrizione da aggiornare (già corrette?)')
}