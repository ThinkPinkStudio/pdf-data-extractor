import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { getSettings } from '@/lib/settingsStore'
import Sidebar from '@/components/Sidebar'
import { getConfig as getInfortuniConfig } from '@/lib/infortuni/store'

export default async function ProtectedLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession()
  if (!session.email) {
    redirect('/auth/login')
  }
  // Voci di menu nascoste (Impostazioni tecniche → Voci di menu): lette qui,
  // lato server, così la sidebar nasce già giusta senza fetch né sfarfallio.
  // La pagina delle impostazioni fa router.refresh() dopo il salvataggio.
  let navHidden: string[] = []
  let rsmVisible = false
  let infortuniVisible = false
  let vitaVisible = false
  try {
    const st = await getSettings()
    navHidden = st.navHiddenExtractor || []
    rsmVisible = !!st.rsmVisible
    infortuniVisible = !!st.infortuniVisible
    vitaVisible = !!st.vitaVisible
  } catch { navHidden = [] }
  // Nome della sezione Infortuni scelto nelle sue Impostazioni.
  let infortuniName: string | undefined
  try { infortuniName = (await getInfortuniConfig()).sectionName } catch { infortuniName = undefined }

  return (
    <div className="app-shell">
      <Sidebar email={session.email} navHidden={navHidden} rsmVisible={rsmVisible} infortuniVisible={infortuniVisible} vitaVisible={vitaVisible} infortuniName={infortuniName} />
      <main className="main-content">{children}</main>
    </div>
  )
}
