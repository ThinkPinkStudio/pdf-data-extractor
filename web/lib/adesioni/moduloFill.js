/**
 * Logica lato-documento per compilare il modulo HTML (esportato da Pages) e
 * gestire il riflusso dei valori lunghi. Vive come STRINGA iniettata nel
 * contesto della pagina: la usano sia il render reale in Electron
 * (`webContents.executeJavaScript`) sia i test con Chromium/Playwright, così il
 * comportamento provato è esattamente quello che gira in produzione.
 *
 * Due passi:
 *  1. Sostituisce ogni `{{campo}}` nei nodi di testo con il valore reale (il
 *     valore entra come textContent, quindi è intrinsecamente HTML-escaped).
 *  2. Riflusso anti-overflow: il blocco dati dell'aderente (posizionato in modo
 *     assoluto da Pages, `white-space:pre`, che sfora con i valori lunghi) viene
 *     convertito in un flusso centrato che va a capo; tutto ciò che sta sotto la
 *     tabella pacchetti viene spinto giù della quantità necessaria, così non si
 *     sovrappone e non si taglia mai nulla.
 */

/** Ritorna lo script (stringa) da iniettare nella pagina caricata, con i dati già serializzati. */
export function fillAndReflowScript(data) {
  return `(${fillAndReflowFn.toString()})(${JSON.stringify(data || {})});`
}

// Funzione eseguita NEL contesto della pagina (niente riferimenti esterni).
function fillAndReflowFn(DATA) {
  // ── 1. Sostituzione segnaposto nei nodi di testo ──
  var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null)
  var textNodes = []
  while (walker.nextNode()) textNodes.push(walker.currentNode)
  textNodes.forEach(function (n) {
    if (n.nodeValue.indexOf('{{') < 0) return
    n.nodeValue = n.nodeValue.replace(/\{\{(\w+)\}\}/g, function (m, k) {
      return Object.prototype.hasOwnProperty.call(DATA, k) ? String(DATA[k]) : m
    })
  })
  // Fix href degli anchor rimasti col mailto di esempio del template
  Array.prototype.forEach.call(document.querySelectorAll('a[href^="mailto:"]'), function (a) {
    a.setAttribute('href', 'mailto:' + (a.textContent || '').trim())
  })

  // ── 2. Riflusso del blocco dati aderente ──
  var root = document.querySelector('.body > div')
  if (!root) return

  // ── Logo in alto a sinistra (solo se fornito, template predefinito) ──
  // Overlay assoluto: non sposta nulla del resto del modulo.
  if (DATA.__logoDataUri && !root.querySelector('.csa-logo')) {
    var logo = document.createElement('img')
    logo.className = 'csa-logo'
    logo.src = DATA.__logoDataUri
    logo.style.position = 'absolute'
    logo.style.left = '0'
    logo.style.top = '0'
    logo.style.width = '104px'
    logo.style.height = 'auto'
    root.appendChild(logo)
  }
  var CONTENT_W = 566.6           // larghezza utile del contenitore Pages
  var TABLE_TOP = 224.25          // top originale della tabella pacchetti
  var kids = Array.prototype.slice.call(root.children)
  function topOf(el) { var t = parseFloat(el.style.top || '0'); return isNaN(t) ? 0 : t }

  // Blocco dati = elementi con top in [110,215] (da "ADERENTE" a "PREMIO")
  var block = kids.filter(function (el) { var t = topOf(el); return t >= 110 && t <= 215 })
  if (!block.length) return
  var blockTop = Math.min.apply(null, block.map(topOf))

  block.forEach(function (el) {
    el.style.position = 'relative'
    el.style.left = '0'
    el.style.top = '0'
    el.style.width = CONTENT_W + 'px'
    el.style.textAlign = 'center'
    el.style.whiteSpace = 'normal'
    el.style.lineHeight = '1.15'
  })
  var wrap = document.createElement('div')
  wrap.style.position = 'absolute'
  wrap.style.left = '0'
  wrap.style.top = blockTop + 'px'
  wrap.style.width = CONTENT_W + 'px'
  root.insertBefore(wrap, block[0])
  block.forEach(function (el) { wrap.appendChild(el) })

  var BUDGET = 791.8              // altezza del root che sta in un solo foglio A4
  var h = wrap.getBoundingClientRect().height
  var delta = Math.max(0, (blockTop + h) - TABLE_TOP + 4)
  if (delta > 0) {
    kids.forEach(function (el) {
      if (el === wrap) return
      var t = topOf(el)
      if (t >= 220) el.style.top = (t + delta) + 'px'
    })
    var hh = parseFloat(root.style.height || String(BUDGET))
    root.style.height = (hh + delta) + 'px'
  }

  // ── 3. Rientro in una sola pagina ──
  // Se il contenuto (misurato sul punto più basso EFFETTIVO, inclusi i blocchi
  // annidati posizionati in assoluto) supera l'altezza del foglio A4, riduci
  // APPENA la scala del modulo per farlo stare in un'unica pagina, senza
  // spostare né riorganizzare il resto (scala uniforme dall'angolo alto-sinistra).
  // Si usa `zoom` (non `transform: scale`): in Blink lo zoom incide sul LAYOUT,
  // quindi riduce davvero l'impaginazione a una sola pagina; una scala
  // trasformata resterebbe solo visiva e Chromium spezzerebbe comunque in due.
  // L'estensione da contenere è il punto più basso TRA il contenuto reale
  // (blocchi annidati inclusi) e il box stesso del root (la cui altezza è stata
  // allungata dal riflusso): è quest'ultimo a spingere spesso su una 2ª pagina.
  var PAGE_LIMIT = 834           // altezza utile di un A4 nello spazio px del template
  var nodes = root.getElementsByTagName('*')
  var extent = root.getBoundingClientRect().bottom
  for (var i = 0; i < nodes.length; i++) {
    var b = nodes[i].getBoundingClientRect().bottom
    if (b > extent) extent = b
  }
  if (extent > PAGE_LIMIT) {
    root.style.zoom = (PAGE_LIMIT / extent).toFixed(4)
  }
}
