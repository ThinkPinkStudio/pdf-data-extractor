// File separato (in modalità modulo, grazie a `export {}`) da global.d.ts: le
// dichiarazioni wildcard di quest'ultimo (es. "*.css") devono restare in un file
// "script" per essere riconosciute globalmente, mentre l'augmentation di un modulo
// esistente come 'react' richiede invece che il file sia un modulo.
export {}

// Attributo non standard (ma supportato da Chrome/Edge/Firefox) per la selezione
// ricorsiva di cartelle via <input type="file">. Non tipizzato di default in React.
declare module 'react' {
  interface InputHTMLAttributes<T> {
    webkitdirectory?: string
  }
}
