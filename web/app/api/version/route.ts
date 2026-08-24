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
  'profile-content-detect', // pre-filtro bulk: matchKeywords nel contenuto + /api/polizza/bulk/detect
  'label-value-pairs',      // coppie etichetta→valore colonnari nel prompt (ocrLayout)
  'numeric-facts-registry', // registro fatti numerici anti-sub-limite nel merge
  'field-reliability',      // punteggio affidabilità per campo (⚑ in Elaborazioni)
]

export async function GET() {
  return NextResponse.json({
    version: process.env.NEXT_PUBLIC_APP_VERSION || 'n/d',
    buildFeatures: BUILD_FEATURES,
    now: new Date().toISOString(),
  })
}
