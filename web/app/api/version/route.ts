import { NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// "Cosa sta servendo QUESTA istanza?" — verificabile in un comando, mai più a
// parole: `curl -s https://<dominio>/api/version`. Nessun dato sensibile,
// quindi niente autenticazione. La lista buildFeatures è HARDCODED e va
// aggiornata a ogni feature UI rilevante: se una feature è nella lista,
// l'istanza che risponde la sta servendo — indipendentemente da cache del
// browser o proxy.
const BUILD_FEATURES = [
  'strategy-switch',      // Impostazioni → Verifica e qualità → Strategia di estrazione (1.0.107)
  'archive-chat',         // voce Chat archivio + /api/archive/chat (1.0.107)
  'semantic-routing',     // gate campo×documento + arbitro semantico nel merge (1.0.108)
  'maintenance-panel',    // voce Dati → /maintenance + /api/admin/maintenance (1.0.109)
  'storico-ricerca',      // storico delle run + ricerca globale (25/09/2026)
  'riconciliazione',      // riconciliazione dei dossier per numero di polizza (25/09/2026)
  'think-per-fase',       // ragionamento del modello per fase + override nelle run di test (25/09/2026)
  'ocr-visivo-v2',        // OCR con modello visivo, pagine intere (repeat_penalty, trattini → spazi) (25/09/2026)
  'motore-ciclo1',        // correzioni dall'analisi dei 55 errori (prove, verifiche, A.7, date) (25/09/2026)
  'copertura-mai-nominata', // pertinenza: copertura mai nominata = non operante senza modello (25/09/2026)
  'riconciliazione-cf', // riconciliazione: niente CF come numero, copie di fuori non dividono la cartella (26/09/2026)
  'campi-compilabili', // valori dei campi AcroForm nella griglia; pagine digitali dal text layer di adesso (26/09/2026)
  'flag-motore',       // flag del motore per le run di test: campi, cascata4, a78, recupero, elenchi (26/09/2026)
  'contesto-128k',     // (storico) tetto contesto 131072; OCR visivo con 16k token d'uscita (26/09/2026)
  'contesto-256k',     // tetto contesto 262144, ridotto al nativo del modello (qwen3:30b-a3b a 256k ≈ 43 GB) (26/09/2026)
  'non-valido',        // senza polizza = Non valido, mai estratto né forzabile; domanda sulla polizza sempre (26/09/2026)
  'pertinenza-questionario', // «non operante» provato solo in pagine di questionario non contraddice il contratto; nome copertura in ogni forma sul frontespizio (26/09/2026)
]

export async function GET() {
  return NextResponse.json({
    version: process.env.NEXT_PUBLIC_APP_VERSION || 'n/d',
    buildFeatures: BUILD_FEATURES,
    now: new Date().toISOString(),
  })
}
