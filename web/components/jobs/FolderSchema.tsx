'use client'
import { useEffect, useMemo, type ReactNode } from 'react'
import { useT } from '@/lib/i18n/I18nProvider'
import type { FilterKey, JobSnapshot } from './types'
import { FILTER_COLOR, FILTER_LABEL_KEY, countByFilter, filterOf, splitName } from './model'
import { IcFolder, IcX } from './Icons'

interface Node { name: string; children: Node[]; jobs: JobSnapshot[]; all: JobSnapshot[] }

// SCHEMA delle cartelle (finestra a parte, sola lettura): dà un'idea visiva
// di cosa il bulk ha esplorato. Niente azioni, niente livelli da aprire e
// chiudere: cartelle con i conteggi per stato, polizze come foglie con un
// puntino colorato. Per lavorare sulle polizze ci sono Tabella e Coda.
function buildTree(jobs: JobSnapshot[], batchLabel?: string | null): Node {
  const root: Node = { name: '', children: [], jobs: [], all: [] }
  const byPath = new Map<string, Node>([['', root]])
  for (const j of jobs) {
    const { segments } = splitName(j, batchLabel)
    let cur = root
    let p = ''
    cur.all.push(j)
    for (const f of segments.slice(0, -1)) {
      p = p ? `${p}/${f}` : f
      let n = byPath.get(p)
      if (!n) { n = { name: f, children: [], jobs: [], all: [] }; byPath.set(p, n); cur.children.push(n) }
      cur = n
      cur.all.push(j)
    }
    cur.jobs.push(j)
  }
  const sortRec = (n: Node) => {
    n.children.sort((a, b) => a.name.localeCompare(b.name))
    n.jobs.sort((a, b) => splitName(a, batchLabel).name.localeCompare(splitName(b, batchLabel).name))
    n.children.forEach(sortRec)
  }
  sortRec(root)
  return root
}

const COUNT_KEYS: FilterKey[] = ['review', 'mismatch', 'setAside', 'matched', 'active', 'done', 'error']

export function FolderSchema({ jobs, batchLabel, onClose }: { jobs: JobSnapshot[]; batchLabel?: string | null; onClose: () => void }) {
  const t = useT()
  const root = useMemo(() => buildTree(jobs, batchLabel), [jobs, batchLabel])
  const counts = countByFilter(jobs)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const dots = (c: Record<FilterKey, number>) => COUNT_KEYS.filter((k) => c[k] > 0).map((k) => (
    <span key={k} className="jb-leg" title={t(FILTER_LABEL_KEY[k])}><span className="jb-dot" style={{ background: FILTER_COLOR[k] }} />{c[k]}</span>
  ))

  function renderNode(node: Node): ReactNode {
    if (!node.children.length && !node.jobs.length) return null
    return (
      <ul className="jb-schema">
        {node.children.map((c, i) => (
          <li key={`f${i}:${c.name}`}>
            <div className="row">
              <span className="fold"><IcFolder /></span>
              <span className="nm" title={c.name}>{c.name}</span>
              <span className="cnt">{t('jobsDash.rowsN', { n: c.all.length })}</span>
              {dots(countByFilter(c.all))}
            </div>
            {renderNode(c)}
          </li>
        ))}
        {node.jobs.map((j) => {
          const nDocs = (j.scannedFiles || []).length
          return (
            <li key={j.jobId}>
              <div className="row leaf">
                <span className="jb-dot" style={{ background: FILTER_COLOR[filterOf(j)] }} title={t(FILTER_LABEL_KEY[filterOf(j)])} />
                <span className="nm" title={splitName(j, batchLabel).name}>{splitName(j, batchLabel).name}</span>
                <span className="cnt">{nDocs === 1 ? t('jobsDash.docs1') : t('jobsDash.docsN', { n: nDocs })}</span>
              </div>
            </li>
          )
        })}
      </ul>
    )
  }

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div className="card" role="dialog" aria-modal="true" aria-label={t('jobsDash.schemaTitle')} onClick={(e) => e.stopPropagation()}
        style={{ width: 720, maxWidth: '92vw', maxHeight: '84vh', padding: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, padding: '14px 18px 10px', borderBottom: '1px solid var(--c-border)' }}>
          <div>
            <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>{t('jobsDash.schemaTitle')}</h3>
            <p style={{ margin: '2px 0 0', fontSize: 11, color: 'var(--c-text-muted)' }}>{t('jobsDash.treeHint')}</p>
          </div>
          <button type="button" className="jb-btn ghost icon" aria-label={t('jobsDash.close')} title={t('jobsDash.close')} onClick={onClose}><IcX /></button>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 14px', padding: '8px 18px', borderBottom: '1px solid var(--c-border)' }}>
          {COUNT_KEYS.filter((k) => counts[k] > 0).map((k) => (
            <span key={k} className="jb-leg"><span className="jb-dot" style={{ background: FILTER_COLOR[k] }} />{t(FILTER_LABEL_KEY[k])} <b>{counts[k]}</b></span>
          ))}
        </div>
        <div style={{ flex: '1 1 auto', minHeight: 0, overflow: 'auto', padding: '12px 18px 16px' }}>
          <div className="jb-schema-root">
            <span className="fold"><IcFolder /></span>
            <span className="nm">{batchLabel || '…'}</span>
            <span className="cnt">{t('jobsDash.rowsN', { n: jobs.length })}</span>
          </div>
          {renderNode(root)}
        </div>
      </div>
    </div>
  )
}
