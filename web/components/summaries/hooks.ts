'use client'
// RIEPILOGHI — piccoli hook dell'interfaccia: larghezza reale di un
// contenitore (grafici SVG e modalità stretta) ed Escape che chiude SOLO il
// pannello più in alto (drawer, «Personalizza», «Nuovo riepilogo»).
import { useEffect, useRef, useState, type RefObject } from 'react'

/** Larghezza del contenitore, misurata con ResizeObserver (modello JobsTable). */
export function useWidth<E extends HTMLElement = HTMLDivElement>(initial = 0): [RefObject<E | null>, number] {
  const ref = useRef<E>(null)
  const [w, setW] = useState(initial)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    setW(el.getBoundingClientRect().width)
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver((entries) => { for (const e of entries) setW(e.contentRect.width) })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, w]
}

// Pila dei pannelli aperti: Escape chiude l'ultimo aperto. Con un menu ⋯
// aperto (ActionMenu, .jb-menu) Escape chiude solo il menu.
const stack: { id: number; close: () => void }[] = []
let seq = 0
let installed = false
function onKey(e: KeyboardEvent) {
  if (e.key !== 'Escape' || !stack.length) return
  if (typeof document !== 'undefined' && document.querySelector('.jb-menu')) return
  e.preventDefault()
  stack[stack.length - 1].close()
}

export function useEscape(close: () => void, active = true) {
  const ref = useRef(close)
  ref.current = close
  useEffect(() => {
    if (!active) return
    const id = ++seq
    stack.push({ id, close: () => ref.current() })
    if (!installed && typeof window !== 'undefined') { window.addEventListener('keydown', onKey); installed = true }
    return () => {
      const i = stack.findIndex((x) => x.id === id)
      if (i >= 0) stack.splice(i, 1)
    }
  }, [active])
}
