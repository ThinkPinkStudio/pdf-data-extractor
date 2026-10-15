'use client'
// Aggancio dei RIEPILOGHI nella pagina Elaborazioni (batch e estrazioni
// singole): «Aggiungi a un riepilogo ▾» e «Crea riepilogo» per le polizze
// spuntate, e il pannello «Nuovo riepilogo». Un solo posto per le chiamate,
// come useJobActions.
// UNA barra per vista (revisione del 26/09/2026): in Tabella i due pulsanti
// stanno DENTRO la barra delle azioni collettive di JobsTable
// ({R.actions(selezionate)} passato come `extraBulk`); in Coda, che non ha
// quella barra, {R.bar(selezionate, svuota)} sotto la card. In entrambe le
// viste compaiono solo se la selezione contiene almeno una polizza che può
// entrare in un riepilogo (estratta, con valori, stesso profilo).
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { useT } from '@/lib/i18n/I18nProvider'
import type { Refusal, SummaryListItem } from '@/lib/summaryTypes'
import type { JobSnapshot, T } from '@/components/jobs/types'
import { useConfirmPanel, type ConfirmOptions } from '@/components/ConfirmPanel'
import { ActionMenu } from '@/components/jobs/ActionMenu'
import { IcChart, IcChevDown, IcPlus } from '@/components/jobs/Icons'
import { analyzeSelection, type SelectionGroup, type SelectionInfo } from './selection'
import { CreateSummaryPanel, refusalText } from './CreateSummaryPanel'
import { apiErrorText, tn } from './format'

export interface SummarySelection {
  /** Vista Coda: barra propria (la Tabella ha già la barra delle azioni collettive). */
  bar: (selected: JobSnapshot[], onClear: () => void) => ReactNode
  /** Vista Tabella: pulsanti da mettere dentro la barra .jb-bulk di JobsTable. */
  actions: (selected: JobSnapshot[]) => ReactNode
  panel: ReactNode
  confirmPanel: ReactNode
}

type Ask = (message: string, opts?: ConfirmOptions) => Promise<boolean>

export function useSummarySelection({ batchLabel, isSingles }: { batchLabel: string; isSingles: boolean }): SummarySelection {
  const router = useRouter()
  const { ask, panel: confirmPanel } = useConfirmPanel()
  const [create, setCreate] = useState<{ ids: string[] } | null>(null)
  const openCreate = useCallback((ids: string[]) => setCreate({ ids }), [])

  const bar = (selected: JobSnapshot[], onClear: () => void) => {
    const info = selected.length ? analyzeSelection(selected) : null
    return info?.main ? <SummarySelectionBar info={info} onClear={onClear} onCreate={openCreate} ask={ask} creating={!!create} /> : null
  }
  const actions = (selected: JobSnapshot[]) => {
    const info = selected.length ? analyzeSelection(selected) : null
    return info?.main ? <SummaryBulkActions info={info} onCreate={openCreate} ask={ask} creating={!!create} /> : null
  }

  const panel = create ? (
    <CreateSummaryPanel
      jobIds={create.ids}
      defaultName={!isSingles && batchLabel ? batchLabel : null}
      onClose={() => setCreate(null)}
      onCreated={(id) => { setCreate(null); router.push(`/polizza/riepiloghi/${encodeURIComponent(id)}`) }}
      active={!confirmPanel}
    />
  ) : null

  return { bar, actions, panel, confirmPanel }
}

const groupName = (t: T, g: SelectionGroup) => g.profileName || t('rp.profileFromFields', { n: g.fieldCount })

/**
 * Riepiloghi dello stesso profilo della selezione (menu «Aggiungi a un
 * riepilogo») e l'aggiunta: le polizze ammissibili entrano, le altre tornano
 * col motivo (pannello di conferma). Stato condiviso dalle due forme della barra.
 */
function useAddTo(main: SelectionGroup, ask: Ask) {
  const t = useT()
  const entering = main.jobs
  const firstId = entering[0]?.jobId || ''
  const key = main.key
  const [lists, setLists] = useState<{ key: string; items: SummaryListItem[] | null }>({ key: '', items: null })
  const [nonce, setNonce] = useState(0)
  const [busy, setBusy] = useState(false)
  const [flash, setFlash] = useState<{ text: string; id: string } | null>(null)

  // Si ricaricano al cambio del profilo (chiave) e dopo un'aggiunta.
  useEffect(() => {
    if (!firstId) return
    let alive = true
    setLists((cur) => (cur.key === key ? cur : { key, items: null }))
    fetch(`/api/polizza/summaries?jobId=${encodeURIComponent(firstId)}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : { summaries: [] }))
      .then((d) => { if (alive) setLists({ key, items: Array.isArray(d?.summaries) ? d.summaries : [] }) })
      .catch(() => { if (alive) setLists({ key, items: [] }) })
    return () => { alive = false }
    // firstId cambia a ogni spunta: basta la chiave del profilo (e il nonce).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, nonce])

  useEffect(() => {
    if (!flash) return
    const id = setTimeout(() => setFlash(null), 6000)
    return () => clearTimeout(id)
  }, [flash])

  const refusedLines = (refused: Refusal[]) => {
    const lines = refused.slice(0, 8).map((x) => refusalText(t, x))
    if (refused.length > 8) lines.push(`+${refused.length - 8}`)
    return lines
  }

  async function addTo(s: SummaryListItem) {
    if (!entering.length || busy) return
    setBusy(true)
    try {
      const r = await fetch(`/api/polizza/summaries/${encodeURIComponent(s.id)}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ addJobIds: entering.map((j) => j.jobId) }),
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) {
        const refused: Refusal[] = Array.isArray(d?.refused) ? d.refused : []
        void ask([apiErrorText(t, d, r.status), ...refusedLines(refused)].join('\n'), { hideCancel: true, okLabel: t('rp.ok'), title: t('rp.sel.addTo') })
        return
      }
      const added = d?.result?.added?.length || 0
      const already = d?.result?.already?.length || 0
      const refused: Refusal[] = Array.isArray(d?.result?.refused) ? d.result.refused : []
      const head = added ? tn(t, 'rp.sel.added', added, { name: s.name }) : t('rp.sel.addedNone', { name: s.name })
      setFlash({
        text: [head, already ? tn(t, 'rp.sel.already', already) : '', refused.length ? tn(t, 'rp.sel.notAdded', refused.length) : ''].filter(Boolean).join(' · '),
        id: s.id,
      })
      setNonce((n) => n + 1)
      // Le polizze rimaste fuori (doppioni, altro profilo…) si dicono col motivo.
      if (refused.length) void ask([tn(t, 'rp.new.refused', refused.length), ...refusedLines(refused)].join('\n'), { hideCancel: true, okLabel: t('rp.ok'), title: t('rp.sel.notAddedTitle') })
    } catch {
      void ask(apiErrorText(t, null, 0), { hideCancel: true, okLabel: t('rp.ok'), title: t('rp.sel.addTo') })
    } finally {
      setBusy(false)
    }
  }

  const items = lists.items === null
    ? [{ id: 'loading', label: t('rp.sel.loading'), onClick: () => {}, disabled: true }]
    : lists.items.length === 0
      ? [{ id: 'none', label: t('rp.sel.addNone'), onClick: () => {}, disabled: true }]
      : lists.items.map((s) => ({ id: s.id, label: tn(t, 'rp.sel.addItem', s.jobCount, { name: s.name }), icon: <IcChart />, onClick: () => void addTo(s), disabled: busy }))

  return { entering, items, busy, flash }
}

/** Testo del tooltip di «Crea riepilogo»: chi entra, profili diversi, escluse. */
function createTitle(t: T, info: SelectionInfo, main: SelectionGroup): string {
  const profile = groupName(t, main)
  const parts = [tn(t, 'rp.sel.createTitle', main.jobs.length, { profile })]
  if (info.mixed) parts.push(tn(t, 'rp.sel.mixed', main.jobs.length, { profile }))
  if (info.excluded > 0) parts.push(`${tn(t, 'rp.sel.excluded', info.excluded)}: ${t('rp.sel.excludedTitle')}`)
  return parts.join(' · ')
}

/** Vista Tabella: pulsanti dentro la barra delle azioni collettive (niente seconda barra). */
function SummaryBulkActions({ info, onCreate, ask, creating }: {
  info: SelectionInfo
  onCreate: (ids: string[]) => void
  ask: Ask
  creating: boolean
}) {
  const t = useT()
  const main = info.main as SelectionGroup
  const { entering, items, busy, flash } = useAddTo(main, ask)
  return (
    <>
      <span className="sep" />
      <ActionMenu ariaLabel={t('rp.sel.addTo')} className="btn-secondary" trigger={<><IcChart />{t('rp.sel.addTo')}<IcChevDown /></>} items={items} />
      <button type="button" className="jb-btn btn-secondary" disabled={busy || creating} title={createTitle(t, info, main)} onClick={() => onCreate(entering.map((j) => j.jobId))}>
        <IcPlus />{t('rp.sel.create')}
      </button>
      {flash && (
        <span className="jb-c-ok" role="status" style={{ fontSize: 11 }}>
          {flash.text} · <Link href={`/polizza/riepiloghi/${encodeURIComponent(flash.id)}`}>{t('rp.sel.open')}</Link>
        </span>
      )}
    </>
  )
}

/** Vista Coda: barra propria (mockup Main.dc.html). */
function SummarySelectionBar({ info, onClear, onCreate, ask, creating }: {
  info: SelectionInfo
  onClear: () => void
  onCreate: (ids: string[]) => void
  ask: Ask
  creating: boolean
}) {
  const t = useT()
  const main = info.main as SelectionGroup
  const { entering, items, busy, flash } = useAddTo(main, ask)
  const profile = groupName(t, main)

  return (
    <div className="rp-selbar" role="toolbar" aria-label={t('rp.sel.aria')}>
      <div className="txt">
        <span className="c">{tn(t, 'rp.sel.count', info.total)}</span>
        <span className="s">
          {info.mixed
            ? <span className="jb-c-warn" title={info.groups.map((g) => `${groupName(t, g)}: ${g.jobs.length}`).join(' · ')}>{tn(t, 'rp.sel.mixed', entering.length, { profile })}</span>
            : t('rp.sel.allProfile', { profile })}
          {' · '}{t('rp.sel.onlyDone')}
          {info.excluded > 0 && <> · <span className="jb-c-warn" title={t('rp.sel.excludedTitle')}>{tn(t, 'rp.sel.excluded', info.excluded)}</span></>}
        </span>
        {flash && (
          <span className="s jb-c-ok" role="status">
            {flash.text} · <Link href={`/polizza/riepiloghi/${encodeURIComponent(flash.id)}`}>{t('rp.sel.open')}</Link>
          </span>
        )}
      </div>
      <div className="acts">
        <button type="button" className="jb-btn btn-secondary rp-btn" onClick={onClear}>{t('common.cancel')}</button>
        <ActionMenu ariaLabel={t('rp.sel.addTo')} className="btn-secondary rp-btn rp-menubtn" trigger={<>{t('rp.sel.addTo')}<IcChevDown /></>} items={items} />
        <button type="button" className="jb-btn btn-primary rp-btn" disabled={busy || creating} onClick={() => onCreate(entering.map((j) => j.jobId))}>
          <IcPlus />{t('rp.sel.create')}
        </button>
      </div>
    </div>
  )
}
