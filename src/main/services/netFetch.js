import { net } from 'electron'

// ─── Rete in uscita via stack Chromium (net.fetch) ───────────────────────────
//
// Usiamo net.fetch (modulo `net` di Electron) invece del fetch globale di Node
// (undici) per TUTTE le chiamate HTTP/HTTPS in uscita del processo main.
//
// Perché è importante in ambiente aziendale:
//   • net.fetch passa dallo stack di rete di Chromium, che rispetta
//     automaticamente il PROXY DI SISTEMA (PAC/WPAD/manuale).
//   • si fida dei CERTIFICATI/CA del sistema operativo, incluse le CA
//     aziendali installate da firewall/VPN che fanno ispezione TLS (MITM).
//
// Il fetch di Node, invece, ignora il proxy di sistema e usa una propria lista
// di CA: dietro una VPN/firewall con ispezione TLS fallisce con "fetch failed"
// (tipico: "unable to get local issuer certificate" / "self signed certificate
// in certificate chain"). net.fetch no.
//
// È un drop-in: stessa API Request/Response del fetch standard, supporta
// method/headers/body, AbortSignal e lo streaming via res.body.getReader().
export function netFetch(url, options = {}) {
  return net.fetch(url, options)
}

// Traduce un errore di rete (o uno stato HTTP) in una diagnosi leggibile,
// pensata per chi è dietro proxy/firewall/VPN aziendali.
// Ritorna { stage, message }.
export function describeNetworkError(err) {
  const raw = (err && (err.message || String(err))) || 'errore sconosciuto'
  const low = raw.toLowerCase()

  if (low.includes('abort') || low.includes('timed out') || low.includes('timeout') || low.includes('etimedout')) {
    return { stage: 'timeout', message: `Timeout: nessuna risposta entro il limite. Un proxy/firewall potrebbe bloccare l'uscita. (${raw})` }
  }
  if (low.includes('certificate') || low.includes('cert_') || low.includes('err_cert') ||
      low.includes('issuer') || low.includes('self-signed') || low.includes('self signed') ||
      low.includes('ssl') || low.includes('tls')) {
    return { stage: 'tls', message: `Errore certificato TLS: la rete fa probabilmente ispezione TLS con una CA aziendale non riconosciuta. (${raw})` }
  }
  if (low.includes('enotfound') || low.includes('name_not_resolved') || low.includes('getaddrinfo') || low.includes('dns')) {
    return { stage: 'dns', message: `DNS non risolto: dominio non raggiungibile da questa rete (DNS/proxy). (${raw})` }
  }
  if (low.includes('econnrefused') || low.includes('connection_refused') || low.includes('refused')) {
    return { stage: 'connect', message: `Connessione rifiutata: un proxy/firewall sta bloccando l'uscita verso il provider. (${raw})` }
  }
  if (low.includes('proxy')) {
    return { stage: 'proxy', message: `Errore proxy: configurazione proxy di sistema non valida o non raggiungibile. (${raw})` }
  }
  return { stage: 'network', message: raw }
}
