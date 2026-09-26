// Hook di risoluzione per i test che caricano moduli TypeScript del web con
// --experimental-strip-types: Next risolve l'alias «@/…» (tsconfig paths) e
// gli import senza estensione, Node no. Qui «@/x» → web/x e, se il file senza
// estensione non esiste, si riprova con «.ts». Solo per i test (registrato da
// uiJobState.cases.mjs con module.register), mai a runtime.
let webRoot = null

export function initialize(data) {
  webRoot = data?.webRoot || null
}

export async function resolve(specifier, context, nextResolve) {
  let spec = specifier
  if (webRoot && spec.startsWith('@/')) spec = new URL(spec.slice(2), webRoot).href
  try {
    return await nextResolve(spec, context)
  } catch (err) {
    if (err?.code === 'ERR_MODULE_NOT_FOUND' && !/\.[cm]?[jt]sx?$/.test(spec)) return nextResolve(`${spec}.ts`, context)
    throw err
  }
}
