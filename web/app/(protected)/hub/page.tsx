import { getSettings } from '@/lib/settingsStore'
import HubClient from './HubClient'

// La sezione Anagrafiche RSM compare solo se accesa in Impostazioni tecniche
// (`rsmVisible`, spenta di default finché non è pronta).
export default async function HubPage() {
  let rsmVisible = false
  try { rsmVisible = !!(await getSettings()).rsmVisible } catch { rsmVisible = false }
  return <HubClient rsmVisible={rsmVisible} />
}
