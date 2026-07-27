import { CompareProvider } from '@/lib/compare/CompareProvider'
import './compare.css'

// Layout della sezione Portafoglio Compare: mantiene in memoria i file caricati
// e la configurazione mentre si naviga tra Comparazione / Ricerca / In Entrambi.
// Il wrapper `.compare-scope` riporta la sezione al tema CHIARO originale
// (accento malva #C8477A) rimappando i token --c-* del hub (vedi globals.css).
export default function CompareLayout({ children }: { children: React.ReactNode }) {
  return (
    <CompareProvider>
      <div className="compare-scope">{children}</div>
    </CompareProvider>
  )
}
