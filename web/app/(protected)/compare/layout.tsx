import { CompareProvider } from '@/lib/compare/CompareProvider'

// Layout della sezione Portafoglio Compare: mantiene in memoria i file caricati
// e la configurazione mentre si naviga tra Comparazione / Ricerca / In Entrambi.
export default function CompareLayout({ children }: { children: React.ReactNode }) {
  return <CompareProvider>{children}</CompareProvider>
}
