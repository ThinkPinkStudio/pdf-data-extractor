'use client'

// Pannelli di una riga di copertura, usati dalla tabella dello stato di rischio
// e dalla scheda della persona: cessazione (con i familiari del nucleo) e
// correzione dei dati, coi controlli del codice fiscale mentre si scrive.
import { useState } from 'react'
import { useI18n } from '@/lib/i18n/I18nProvider'
import { today } from '@/components/rsm/useRsm'
import type { Row } from '@/components/rsm/useRsm'
import { checkPerson } from '@/lib/rsm/rules.js'
import type { RsmIssue } from '@/lib/rsm/types'

export function CeasePanel({ row, nucleus, busy, onCancel, onSave }: {
  row: Row; nucleus: Row[]; busy: boolean; onCancel: () => void
  onSave: (ids: string[], exitDate: string, comm: string, note: string) => void
}) {
  const { t } = useI18n()
  const [date, setDate] = useState(today())
  const [comm, setComm] = useState(today())
  const [note, setNote] = useState('')
  const others = row.legame === 'TI' ? nucleus.filter((x) => x.id !== row.id && !x.exitKind) : []
  const [withFam, setWithFam] = useState(true)
  const ids = [row.id, ...(withFam ? others.map((x) => x.id) : [])]
  return (
    <div className="rsm-panel">
      <div className="rsm-box-title">{t('rsm.st.ceaseTitle', { name: `${row.cognome} ${row.nome}` })}</div>
      <div className="rsm-row">
        <label className="rsm-field w-date">{t('rsm.ceaseDate')}<input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
        <label className="rsm-field w-date">{t('rsm.mailDate')}<input type="date" value={comm} onChange={(e) => setComm(e.target.value)} /></label>
        <label className="rsm-field" style={{ flex: 1, minWidth: 220 }}>{t('rsm.note')}<input value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('rsm.notePh')} /></label>
      </div>
      {others.length > 0 && (
        <label className="rsm-muted" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <input type="checkbox" checked={withFam} onChange={(e) => setWithFam(e.target.checked)} />{t('rsm.st.withFam', { n: others.length })}
        </label>
      )}
      <div className="rsm-note">{t('rsm.st.ceaseHint')}</div>
      <div className="rsm-row">
        <button className="btn btn-primary" disabled={busy || !date} onClick={() => onSave(ids, date, comm, note)}>{t('rsm.st.ceaseSave', { n: ids.length })}</button>
        <button className="btn btn-secondary" onClick={onCancel}>{t('common.cancel')}</button>
      </div>
    </div>
  )
}

export function EditPanel({ row, year, busy, onCancel, onSave }: { row: Row; year: number; busy: boolean; onCancel: () => void; onSave: (p: Record<string, unknown>) => void }) {
  const { t } = useI18n()
  const [f, setF] = useState({ cognome: row.cognome, nome: row.nome, cf: row.cf, birthDate: row.birthDate || '', entryDate: row.entryDate || '', note: row.note || '', quiescente: row.quiescente, cfTitolare: row.cfTitolare || '' })
  const set = (k: string, v: unknown) => setF((x) => ({ ...x, [k]: v }))
  const issues = (checkPerson({ cognome: f.cognome, nome: f.nome, cf: f.cf, birthDate: f.birthDate || null }, year).issues as RsmIssue[]).filter((i) => i.level !== 'info')
  return (
    <div className="rsm-panel">
      <div className="rsm-box-title">{t('rsm.st.editTitle', { name: `${row.cognome} ${row.nome}` })}</div>
      <div className="rsm-row">
        <label className="rsm-field">{t('rsm.col.surname')}<input value={f.cognome} onChange={(e) => set('cognome', e.target.value)} /></label>
        <label className="rsm-field">{t('rsm.col.name')}<input value={f.nome} onChange={(e) => set('nome', e.target.value)} /></label>
        <label className="rsm-field">{t('rsm.col.cf')}<input value={f.cf} onChange={(e) => set('cf', e.target.value.toUpperCase())} style={{ width: 200 }} /></label>
        <label className="rsm-field w-date">{t('rsm.col.birth')}<input type="date" value={f.birthDate} onChange={(e) => set('birthDate', e.target.value)} /></label>
        {row.legame !== 'TI' && <label className="rsm-field">{t('rsm.col.cfTit')}<input value={f.cfTitolare} onChange={(e) => set('cfTitolare', e.target.value.toUpperCase())} style={{ width: 200 }} /></label>}
        <label className="rsm-field w-date">{t('rsm.col.entry')}<input type="date" value={f.entryDate} onChange={(e) => set('entryDate', e.target.value)} disabled={row.entryKind === 'promozione'} /></label>
        {row.legame === 'TI' && (
          <label className="rsm-muted" style={{ display: 'flex', gap: 6, alignItems: 'center', height: 36 }}>
            <input type="checkbox" checked={f.quiescente} onChange={(e) => set('quiescente', e.target.checked)} />{t('rsm.quiescente')}
          </label>
        )}
      </div>
      <label className="rsm-field">{t('rsm.note')}<input value={f.note} onChange={(e) => set('note', e.target.value)} /></label>
      {f.entryDate !== (row.entryDate || '') && <div className="rsm-note">{t('rsm.st.forcedHint')}</div>}
      {issues.map((i) => <div key={i.code} className={`rsm-issue ${i.level}`}>{i.text}</div>)}
      <div className="rsm-row">
        <button className="btn btn-primary" disabled={busy} onClick={() => {
          const patch: Record<string, unknown> = { cognome: f.cognome, nome: f.nome, cf: f.cf, birthDate: f.birthDate || null, note: f.note, quiescente: f.quiescente }
          if (row.legame !== 'TI') patch.cfTitolare = f.cfTitolare
          if (f.entryDate && f.entryDate !== row.entryDate) { patch.entryDate = f.entryDate; patch.entryForced = true }
          onSave(patch)
        }}>{t('rsm.save')}</button>
        <button className="btn btn-secondary" onClick={onCancel}>{t('common.cancel')}</button>
      </div>
    </div>
  )
}
