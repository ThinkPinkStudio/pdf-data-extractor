try {
  const m = await import('./src/main/services/polizzaService.js')
  const keys = Object.keys(m)
  console.log('IMPORT OK. N. exports:', keys.length)
  console.log('Exports:', keys.join(', '))
} catch (e) {
  console.log('IMPORT FAIL:', e.message)
}
