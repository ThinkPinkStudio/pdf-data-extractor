import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'

// Barra del titolo personalizzata, a tutta larghezza, in cima alla finestra.
//
// - L'intera barra è una zona di trascinamento (-webkit-app-region: drag) → la
//   finestra si può spostare da qualunque punto (risolve il problema su macOS).
// - I controlli finestra (min/ingrandisci/chiudi) stanno a DESTRA, come da
//   convenzione Windows/Linux (prima erano in alto a sinistra nella sidebar).
// - Su macOS i semafori nativi restano a sinistra: la barra riserva loro lo
//   spazio (classe .titlebar-mac) così non si sovrappongono più al logo.

const platform = window.electronAPI?.platform
const isMac = platform === 'darwin'
const isWindows = platform === 'win32'
const isLinux = platform === 'linux'
const showWindowControls = isWindows || isLinux

function WindowControls() {
  const [maximized, setMaximized] = useState(false)

  useEffect(() => {
    window.electronAPI?.windowIsMaximized().then(setMaximized)
    window.electronAPI?.onWindowMaximizeChange(setMaximized)
    return () => window.electronAPI?.removeWindowMaximizeListeners()
  }, [])

  return (
    <div className="win-controls">
      <button
        className="win-btn win-btn-min"
        onClick={() => window.electronAPI?.windowMinimize()}
        title="Minimizza"
        aria-label="Minimizza"
      >
        <svg viewBox="0 0 10 1" width="10" height="1" fill="currentColor"><rect width="10" height="1" /></svg>
      </button>
      <button
        className="win-btn win-btn-max"
        onClick={() => window.electronAPI?.windowMaximize().then(() => window.electronAPI?.windowIsMaximized().then(setMaximized))}
        title={maximized ? 'Ripristina' : 'Ingrandisci'}
        aria-label={maximized ? 'Ripristina' : 'Ingrandisci'}
      >
        {maximized
          ? <svg viewBox="0 0 10 10" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="1"><rect x="2" y="0" width="8" height="8" /><rect x="0" y="2" width="8" height="8" fill="var(--c-bg-app)" /><rect x="0" y="2" width="8" height="8" /></svg>
          : <svg viewBox="0 0 10 10" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="1"><rect x="0" y="0" width="10" height="10" /></svg>
        }
      </button>
      <button
        className="win-btn win-btn-close"
        onClick={() => window.electronAPI?.windowClose()}
        title="Chiudi"
        aria-label="Chiudi"
      >
        <svg viewBox="0 0 10 10" width="10" height="10" stroke="currentColor" strokeWidth="1.2"><line x1="0" y1="0" x2="10" y2="10" /><line x1="10" y1="0" x2="0" y2="10" /></svg>
      </button>
    </div>
  )
}

export default function TitleBar() {
  const { t } = useTranslation()
  return (
    <div className={`titlebar${isMac ? ' titlebar-mac' : ''}`}>
      <div className="titlebar-title">{t('brand.name')}</div>
      {showWindowControls && <WindowControls />}
    </div>
  )
}
