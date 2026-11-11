'use client'
import { useState } from 'react'
import { useT } from '@/lib/i18n/I18nProvider'
import { useConfirmPanel } from '@/components/ConfirmPanel'

// CARICAMENTO NON CHIUSO: un batch nuovo parte (riunione per numero di polizza,
// poi abbinamento ed estrazione) solo quando il caricamento è chiuso. Lo chiude
// «Fine caricamento» della pagina Cartella bulk o la chiusura della scheda; chi
// usciva dalla pagina col menu lasciava il batch fermo «in coda» per sempre
// (Lipari J - T, 22/10/2026). Da qui lo si chiude dalla lista e dalla pagina del batch.
export function useCloseUpload(reload: () => void | Promise<void>) {
  const t = useT()
  const { ask, panel } = useConfirmPanel()
  const [busy, setBusy] = useState(false)

  // Risolve con il messaggio d'errore, oppure null (chiuso o annullato).
  async function close(batchId: string, label: string, n: number): Promise<string | null> {
    if (!(await ask(t('jobsDash.uploadCloseConfirm', { label, n }), { okLabel: t('jobsDash.uploadCloseOk') }))) return null
    setBusy(true)
    try {
      const res = await fetch(`/api/polizza/batch/${batchId}/complete`, { method: 'POST' })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        return t('jobsDash.uploadCloseFailed', { error: d.error || `HTTP ${res.status}` })
      }
      await reload()
      return null
    } catch (e) {
      return t('jobsDash.uploadCloseFailed', { error: (e as Error).message })
    } finally {
      setBusy(false)
    }
  }

  return { close, busy, panel }
}
