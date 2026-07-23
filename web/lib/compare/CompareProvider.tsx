'use client'

import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import { defaultCompareConfig, type CompareConfig, type Workbook } from './engine'

interface LoadedFile {
  name: string
  wb: Workbook
}

interface CompareCtx {
  fileA: LoadedFile | null
  fileB: LoadedFile | null
  setFileA: (f: LoadedFile | null) => void
  setFileB: (f: LoadedFile | null) => void
  config: CompareConfig
  setConfig: (c: CompareConfig) => void
  saveConfig: (c: CompareConfig) => Promise<void>
  loaded: boolean
}

const Ctx = createContext<CompareCtx | null>(null)

// Mappa i valori piatti restituiti da /api/settings nella CompareConfig.
function configFromSettings(d: Record<string, unknown>): CompareConfig {
  const base = defaultCompareConfig()
  return {
    matchKeys: Array.isArray(d.compareMatchKeys) ? (d.compareMatchKeys as CompareConfig['matchKeys']) : base.matchKeys,
    fuzzyMinOverlap: typeof d.compareFuzzyMinOverlap === 'number' ? d.compareFuzzyMinOverlap : base.fuzzyMinOverlap,
    fuzzyBroadEnabled: d.compareFuzzyBroadEnabled !== false,
    fuzzyMinOverlapBroad: typeof d.compareFuzzyMinOverlapBroad === 'number' ? d.compareFuzzyMinOverlapBroad : base.fuzzyMinOverlapBroad,
    searchConditions: Array.isArray(d.compareSearchConditions) && d.compareSearchConditions.length ? (d.compareSearchConditions as CompareConfig['searchConditions']) : base.searchConditions,
    bothMatchConditions: Array.isArray(d.compareBothMatchConditions) && d.compareBothMatchConditions.length ? (d.compareBothMatchConditions as CompareConfig['bothMatchConditions']) : base.bothMatchConditions,
    bothFilterConditions: Array.isArray(d.compareBothFilterConditions) ? (d.compareBothFilterConditions as CompareConfig['bothFilterConditions']) : base.bothFilterConditions,
  }
}

export function CompareProvider({ children }: { children: React.ReactNode }) {
  const [fileA, setFileA] = useState<LoadedFile | null>(null)
  const [fileB, setFileB] = useState<LoadedFile | null>(null)
  const [config, setConfig] = useState<CompareConfig>(defaultCompareConfig())
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    fetch('/api/settings')
      .then((r) => r.json())
      .then((d) => setConfig(configFromSettings(d)))
      .catch(() => {})
      .finally(() => setLoaded(true))
  }, [])

  const saveConfig = useCallback(async (c: CompareConfig) => {
    setConfig(c)
    await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        compareMatchKeys: c.matchKeys,
        compareFuzzyMinOverlap: c.fuzzyMinOverlap,
        compareFuzzyBroadEnabled: c.fuzzyBroadEnabled,
        compareFuzzyMinOverlapBroad: c.fuzzyMinOverlapBroad,
        compareSearchConditions: c.searchConditions,
        compareBothMatchConditions: c.bothMatchConditions,
        compareBothFilterConditions: c.bothFilterConditions,
      }),
    })
  }, [])

  return (
    <Ctx.Provider value={{ fileA, fileB, setFileA, setFileB, config, setConfig, saveConfig, loaded }}>
      {children}
    </Ctx.Provider>
  )
}

export function useCompare(): CompareCtx {
  const c = useContext(Ctx)
  if (!c) throw new Error('useCompare must be used within CompareProvider')
  return c
}
