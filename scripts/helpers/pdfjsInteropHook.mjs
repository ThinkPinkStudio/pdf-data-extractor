// Hook di risoluzione per il solo harness reconcile-ocr-check: reindirizza
// `pdfjs-dist/legacy/build/pdf.js` allo shim CJS→ESM (vedi pdfjsShim.mjs).
export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'pdfjs-dist/legacy/build/pdf.js' || specifier === 'pdfjs-dist/legacy/build/pdf.mjs') {
    return { url: new URL('./pdfjsShim.mjs', import.meta.url).href, shortCircuit: true }
  }
  return nextResolve(specifier, context)
}
