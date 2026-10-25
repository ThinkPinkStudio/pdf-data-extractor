// Lingua dei dati demo: DEMO_LANG=en usa il catalogo inglese (data-en.mjs),
// altrimenti quello italiano (data.mjs). I file generati per l'inglese hanno il
// suffisso -en (pdfs-en/, bulk-en/, .seed-ids-en.json, video …-en.mp4) e
// convivono con quelli italiani.
export const LANG = process.env.DEMO_LANG === 'en' ? 'en' : 'it'
export const SUFFIX = LANG === 'en' ? '-en' : ''
export const data = await import(LANG === 'en' ? './data-en.mjs' : './data.mjs')
