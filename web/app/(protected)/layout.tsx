import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { getSettings } from '@/lib/settingsStore'
import Sidebar from '@/components/Sidebar'

export default async function ProtectedLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession()
  if (!session.email) {
    redirect('/auth/login')
  }
  // Voci di menu nascoste (Impostazioni tecniche → Voci di menu): lette qui,
  // lato server, così la sidebar nasce già giusta senza fetch né sfarfallio.
  // La pagina delle impostazioni fa router.refresh() dopo il salvataggio.
  let navHidden: string[] = []
  try { navHidden = (await getSettings()).navHiddenExtractor || [] } catch { navHidden = [] }

  return (
    <div className="app-shell">
      <Sidebar email={session.email} navHidden={navHidden} />
      <main className="main-content">{children}</main>
    </div>
  )
}
