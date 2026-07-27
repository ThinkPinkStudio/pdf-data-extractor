# Deploy della web app su Coolify

Questa guida descrive **l'unico** metodo di deploy supportato per la parte web:
**Coolify con build pack Dockerfile**. Non si usa `docker-compose`, non si eseguono
comandi shell: tutto si configura dalla UI di Coolify. Database, Qdrant e SMTP/Resend
sono servizi **esterni gestiti manualmente** — la app riceve solo i loro URL/credenziali
come variabili d'ambiente.

> Il `docker-compose.yml` presente nel repo è solo un riferimento per sviluppo/test
> locale. In produzione su Coolify **non viene usato**.

---

## 1. Creazione del resource

In Coolify: **+ Add Resource → Application → Docker → Dockerfile**.

| Campo Coolify | Valore | Note |
|---|---|---|
| Build Pack | `Dockerfile` | non "Docker Compose", non "Nixpacks" |
| Base Directory | `/` | radice del repo. **Non** `/web`, altrimenti `src/main/services` non è raggiungibile e il build fallisce (`"/src/main/services": not found`) |
| Dockerfile Location | `web/Dockerfile` | il Dockerfile è in `web/`, ma il build context è la radice |
| Ports Exposes | `3000` | porta interna del server Next.js |

### Accesso via IP (senza dominio / senza TLS)

Finché il server è raggiungibile **solo via VPN e solo per IP**, in HTTP puro:

- **Non** assegnare un dominio con "Generate SSL" in Coolify.
- Imposta **Ports Mappings** su `3000:3000` per raggiungere l'app su `http://<IP>:3000`.
- È **obbligatorio** `COOKIE_SECURE=false` (vedi tabella env sotto): senza, il browser
  scarta il cookie di sessione su HTTP e il login entra in loop.

Quando in futuro si passerà a un dominio con TLS: assegnare il dominio in Coolify,
attivare SSL, e cambiare `COOKIE_SECURE=true` + `MAGIC_LINK_BASE_URL=https://<dominio>`.

---

## 2. Variabili d'ambiente (tab "Environment Variables" di Coolify)

### Obbligatorie

| Variabile | Esempio | Note |
|---|---|---|
| `NODE_ENV` | `production` | |
| `COOKIE_SECURE` | `false` | **`false` su HTTP/IP** (senza TLS), altrimenti loop di login. `true` dietro reverse proxy HTTPS. |
| `MAGIC_LINK_BASE_URL` | `http://<IP>:3000` | Deve combaciare **esattamente** con come l'utente raggiunge l'app dal browser. `http` (non `https`) e IP:porta reali. Finisce nel link del magic link. |
| `SESSION_SECRET` | *(random ≥32 caratteri)* | Segreto per cifrare il cookie di sessione. Cambialo. |
| `ALLOWED_DOMAINS` | `azienda.it,partner.it` | Domini email autorizzati, separati da virgola. **Obbligatorio**: se mancante o vuoto **nessun login è ammesso** (fail-closed, come l'app desktop). `*` = tutti, ma solo se impostato **esplicitamente**. Se il dominio del cliente non è incluso, il login viene **negato in silenzio** (per evitare email enumeration l'API risponde comunque `ok`). |
| `DATABASE_URL` | `postgresql://user:pass@host:5432/pdfextractor` | PostgreSQL **esterno**, gestito manualmente. Obbligatorio: `initDb()` gira al boot e crea le tabelle. |
| `QDRANT_URL` | `http://host:6333` | Qdrant **esterno**, gestito manualmente. |

### Email — scegli UNA opzione

**Opzione A (consigliata su server VPN): Resend via HTTP API.** Usa solo HTTPS in
uscita (porta 443), nessun SMTP da gestire. Se `RESEND_API_KEY` è impostata, ha la
precedenza sull'SMTP.

| Variabile | Esempio | Note |
|---|---|---|
| `RESEND_API_KEY` | `re_xxx` | Token API Resend. |
| `SMTP_FROM` | `PDF Extractor <noreply@dominio-verificato>` | Il mittente deve usare un **dominio verificato su Resend** (o `onboarding@resend.dev` per test). |

**Opzione B: SMTP classico** (usato solo se `RESEND_API_KEY` è vuota). Richiede che le
porte SMTP (465/587) siano aperte in uscita dal server — spesso **non** lo sono in VPN.

| Variabile | Esempio |
|---|---|
| `SMTP_HOST` | `smtp.example.com` |
| `SMTP_PORT` | `587` |
| `SMTP_SECURE` | `false` |
| `SMTP_USER` | `noreply@example.com` |
| `SMTP_PASS` | *(password)* |
| `SMTP_FROM` | `PDF Extractor <noreply@example.com>` |

### Opzionali

| Variabile | Default | Note |
|---|---|---|
| `PORT` | `3000` | Porta interna. Se la cambi, aggiorna anche Ports Exposes/Mappings. |
| `MAGIC_LINK_EXPIRY_MINUTES` | `15` | Validità del magic link. |
| `SESSION_MAX_AGE_SECONDS` | `604800` | Durata sessione (default 7 giorni). |
| `ADMIN_EMAILS` | *(nessuno)* | Email con accesso ai log. |
| `LOG_LEVEL` | `info` | |
| `RELEASE_DISTRIBUTOR_URL` | `https://downloads.thinkpinkstudio.it` | Identity provider dell'SSO. **Da dentro la VPN non è raggiungibile** → il login SSO non funziona; usa il magic link. |
| `LLM_PROVIDER` | `ollama` | Provider di default (`ollama` / `openai` / `anthropic`). |
| `LLM_MODEL` | `llama3` | Modello di default per il provider scelto. |
| `OLLAMA_URL` | `http://<IP>:11434` | URL del server Ollama. Vedi §2b per il valore corretto su Coolify. |
| `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` | — | Solo se usi provider cloud. |

> Questi valori LLM fanno da **default iniziale**: appena li salvi dalla UI
> Impostazioni, il valore nel DB vince sull'env (identico comportamento di `QDRANT_URL`).

---

## 2b. Puntare all'Ollama interno al progetto Coolify

Nel progetto l'Ollama gira come **service separato** (`ollama-with-open-webui`),
quindi è una risorsa Coolify diversa dall'app web. Due risorse Coolify stanno di
default su **reti Docker diverse**: l'app web **non** raggiunge Ollama col nome
container finché non le metti in comunicazione. Due modi:

### Modo consigliato (solo‑IP, il più semplice): via IP dell'host

Coerente col resto del deploy (tutto va per IP). Pubblichi la porta di Ollama
sull'host e punti l'app lì.

1. Nel service `ollama-with-open-webui` → **Edit Compose File**, sul servizio
   `ollama` aggiungi una porta pubblicata e forza il bind su tutte le interfacce:
   ```yaml
   services:
     ollama:
       # ...
       ports:
         - "11434:11434"
       environment:
         - OLLAMA_HOST=0.0.0.0
   ```
   Salva e **Restart** il service.
2. Verifica dalla VPN: `http://<IP>:11434/api/tags` deve rispondere con la lista modelli.
3. Nell'app web, tab **Environment Variables**, imposta:
   ```
   OLLAMA_URL=http://<IP>:11434
   ```
   (es. `http://192.168.37.10:11434`). **Redeploy** dell'app.

### Modo alternativo: rete condivisa Coolify (senza pubblicare porte)

1. In **entrambe** le risorse (app web *e* service Ollama), tab **Advanced** →
   attiva **Connect To Predefined Network**. Le mette sulla rete `coolify` condivisa.
2. Trova il nome del container Ollama (tab del service, o `docker ps` dal Terminal
   Coolify: cerca `ollama-...`).
3. Nell'app web imposta `OLLAMA_URL=http://<nome-container-ollama>:11434` e redeploy.

> Se prima settavi `OLLAMA_URL` e "non cambiava niente": era un bug — l'env non
> veniva letta e si usava sempre `localhost:11434` (= il container dell'app, dove
> Ollama non c'è). Ora l'env viene applicata come default.

### Scaricare il modello in Ollama

Ollama parte **vuoto**. Dal Terminal del service Ollama (o via Open WebUI):
```
ollama pull llama3          # o il modello che usi in LLM_MODEL
ollama pull bge-m3          # embeddings, se usi l'indice vettoriale Qdrant
```
Senza il modello scaricato, l'estrazione risponde `404 model not found`.

---

## 3. Riepilogo delle trappole (deploy solo‑IP / HTTP)

1. **Cookie `Secure`** → `COOKIE_SECURE=false`. È la causa n.1 di "login che non entra".
2. **`MAGIC_LINK_BASE_URL`** deve essere `http://<IP>:porta`, non `https`, non un dominio d'esempio.
3. **Login solo via magic link**: l'SSO punta a un host pubblico non raggiungibile dalla VPN.
   Serve quindi un canale email funzionante (Resend consigliato).
4. **`ALLOWED_DOMAINS`** deve includere il dominio del cliente (o `*`), altrimenti nessuno entra.
5. **`DATABASE_URL` e `QDRANT_URL`** puntano a servizi esterni gestiti manualmente: senza un
   PostgreSQL raggiungibile il container va in crash al boot.
6. **Nessun `docker-compose`**: il deploy è Dockerfile-only. Il `docker-compose.yml` del repo
   è solo per sviluppo locale.

---

## 4. Health check

L'app espone `GET /api/health`. Puoi usarlo come health check in Coolify.
