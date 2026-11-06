import { getSettings } from '@/lib/settingsStore'
import HubClient from './HubClient'

// Le sezioni Anagrafiche RSM e CSA Adesioni Infortuni compaiono solo se accese
// in Impostazioni tecniche (`rsmVisible`, `infortuniVisible`, spente di default).
export default async function HubPage() {
  let rsmVisible = false
  let infortuniVisible = false
  try {
    const st = await getSettings()
    rsmVisible = !!st.rsmVisible
    infortuniVisible = !!st.infortuniVisible
  } catch { rsmVisible = false }
  return <HubClient rsmVisible={rsmVisible} infortuniVisible={infortuniVisible} />
}
