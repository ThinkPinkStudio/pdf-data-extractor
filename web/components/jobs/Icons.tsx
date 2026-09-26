// Icone a tratto (12px) della pagina Elaborazioni: niente emoji nei pulsanti.
import type { ReactNode } from 'react'

function Ic({ children, fill }: { children: ReactNode; fill?: boolean }) {
  return fill
    ? <svg className="jb-ico" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">{children}</svg>
    : <svg className="jb-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>
}

export const IcPlay = () => <Ic fill><path d="M7 4.5v15l12-7.5z" /></Ic>
export const IcRefresh = () => <Ic><path d="M21 12a9 9 0 1 1-2.6-6.4" /><path d="M21 4v5h-5" /></Ic>
export const IcDownload = () => <Ic><path d="M12 4v11" /><path d="m7 10 5 5 5-5" /><path d="M4 20h16" /></Ic>
export const IcZip = () => <Ic><rect x="3" y="4" width="18" height="5" rx="1" /><path d="M5 9v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9" /><path d="M10 13h4" /></Ic>
export const IcMore = () => <Ic fill><circle cx="5" cy="12" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="19" cy="12" r="2" /></Ic>
export const IcFile = () => <Ic><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5" /></Ic>
export const IcChevDown = () => <Ic><path d="m6 9 6 6 6-6" /></Ic>
export const IcChevRight = () => <Ic><path d="m9 6 6 6-6 6" /></Ic>
export const IcChevLeft = () => <Ic><path d="m15 6-6 6 6 6" /></Ic>
export const IcX = () => <Ic><path d="M18 6 6 18" /><path d="m6 6 12 12" /></Ic>
export const IcCheck = () => <Ic><path d="m5 12 5 5L20 7" /></Ic>
export const IcHelp = () => <Ic><circle cx="12" cy="12" r="9" /><path d="M9.6 9.5a2.4 2.4 0 1 1 3.4 2.2c-.7.4-1 .9-1 1.6" /><path d="M12 17h.01" /></Ic>
export const IcAlert = () => <Ic><path d="M12 9v4" /><path d="M12 17h.01" /><path d="M10.3 4 2.5 18a2 2 0 0 0 1.7 3h15.6a2 2 0 0 0 1.7-3L13.7 4a2 2 0 0 0-3.4 0z" /></Ic>
export const IcXCircle = () => <Ic><circle cx="12" cy="12" r="9" /><path d="m15 9-6 6" /><path d="m9 9 6 6" /></Ic>
export const IcPause = () => <Ic fill><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" /></Ic>
export const IcClock = () => <Ic><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></Ic>
export const IcSwap = () => <Ic><path d="M4 7h13" /><path d="m14 4 3 3-3 3" /><path d="M20 17H7" /><path d="m10 14-3 3 3 3" /></Ic>
export const IcFlask = () => <Ic><path d="M9 3h6" /><path d="M10 3v6L4.5 19a1.5 1.5 0 0 0 1.3 2h12.4a1.5 1.5 0 0 0 1.3-2L14 9V3" /></Ic>
export const IcCopy = () => <Ic><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h10" /></Ic>
export const IcList = () => <Ic><path d="M8 6h13" /><path d="M8 12h13" /><path d="M8 18h13" /><path d="M3 6h.01" /><path d="M3 12h.01" /><path d="M3 18h.01" /></Ic>
export const IcSearch = () => <Ic><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></Ic>
export const IcTable = () => <Ic><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 10h18" /><path d="M3 15h18" /><path d="M9 10v10" /></Ic>
export const IcQueue = () => <Ic><rect x="3" y="4" width="7" height="16" rx="1.5" /><rect x="13" y="4" width="8" height="16" rx="1.5" /><path d="M5 8h3" /><path d="M5 12h3" /></Ic>
export const IcExternal = () => <Ic><path d="M14 4h6v6" /><path d="M20 4 10 14" /><path d="M18 13v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h6" /></Ic>
export const IcSort = () => <Ic><path d="m8 9 4-4 4 4" /><path d="m8 15 4 4 4-4" /></Ic>
export const IcFolder = () => <Ic><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></Ic>
export const IcTree = () => <Ic><circle cx="6" cy="5" r="2" /><circle cx="6" cy="19" r="2" /><circle cx="17" cy="12" r="2" /><path d="M6 7v10" /><path d="M6 12h9" /></Ic>
// Riepiloghi (26/09/2026): barre (voce di menu e card), cursori (Personalizza), più (Crea riepilogo).
export const IcChart = () => <Ic><path d="M18 20V10" /><path d="M12 20V4" /><path d="M6 20v-6" /></Ic>
export const IcSliders = () => <Ic><path d="M4 6h9" /><path d="M17 6h3" /><circle cx="15" cy="6" r="2" /><path d="M4 12h3" /><path d="M11 12h9" /><circle cx="9" cy="12" r="2" /><path d="M4 18h11" /><path d="M19 18h1" /><circle cx="17" cy="18" r="2" /></Ic>
export const IcPlus = () => <Ic><path d="M12 5v14" /><path d="M5 12h14" /></Ic>
