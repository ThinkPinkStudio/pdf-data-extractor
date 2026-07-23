# Build context: the repository ROOT (matches docker-compose.yml `context: .`).
#
# The Next.js web app lives in web/, but it imports shared Electron services
# from src/main/services (see web/lib/llmAdapter.ts, web/lib/polizzaService.ts,
# which resolve them as ../../src/main/services). Those services are OUTSIDE the
# web/ directory, so the build context must be the repo root — a Dockerfile can
# never COPY from a parent path outside its build context.
#
# Coolify: set "Base Directory" to the repo root ("/") and "Dockerfile Location"
# to web/Dockerfile. Do NOT set the base directory to /web, or src/main/services
# will be unreachable and the build will fail with `"/src/main/services": not found`.
#
# The image mirrors the repo layout: the web app lives at /app/web and the shared
# services at /app/src, so /app/web/lib/* -> ../../src/main/services resolves the
# same way it does in the source tree.
#
# Base: Debian slim (glibc), NON Alpine. Il rendering PDF di CSA Adesioni usa
# Chromium via Playwright, che richiede glibc e le librerie di sistema installate
# più sotto con `playwright install --with-deps chromium`.

# ─── Stage 1: install web dependencies ───────────────────────────────────────
FROM node:20-bookworm-slim AS deps
WORKDIR /app/web

# Il browser di Playwright si installa nello stage runner (con le sue dipendenze
# di sistema): qui si salta il download del postinstall.
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

COPY web/package.json web/package-lock.json* ./
# --include=dev forces devDependencies (typescript, @types/*) to install even when
# the builder sets NODE_ENV=production — next build needs them.
RUN npm ci --include=dev

# ─── Stage 2: build the Next.js web app ──────────────────────────────────────
FROM node:20-bookworm-slim AS builder
WORKDIR /app/web
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

COPY --from=deps /app/web/node_modules ./node_modules

# Web app sources
COPY web ./

# Shared Electron services used directly by the web API routes
COPY src/main/services /app/src/main/services

# Lingua OCR Tesseract (estrazione polizze scansionate offline). tessLangOptions()
# cerca ita.traineddata via TESSERACT_DATA_DIR o cwd/.. → /app (cwd runner = /app/web).
COPY ita.traineddata /app/ita.traineddata

ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# ─── Stage 3: production runner ──────────────────────────────────────────────
FROM node:20-bookworm-slim AS runner
WORKDIR /app/web

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
# Percorso condiviso dei browser Playwright (leggibile dall'utente non privilegiato).
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

# Standalone Next.js output
COPY --from=builder /app/web/.next/standalone ./
COPY --from=builder /app/web/.next/static ./.next/static
COPY --from=builder /app/web/public ./public

# Asset di CSA Adesioni (template docx, template HTML del modulo, DIP, logo):
# letti a runtime via process.cwd()/assets/adesioni. Lo standalone non li include.
COPY --from=builder /app/web/assets ./assets

# pg/nodemailer/exceljs/docxtemplater/pdf-lib/playwright sono JS — no rebuild nativo
COPY --from=deps /app/web/node_modules ./node_modules

# Shared Electron services (kept at /app/src so cwd/../src/main/services resolves)
COPY --from=builder /app/src /app/src
COPY --from=builder /app/ita.traineddata /app/ita.traineddata

# I servizi condivisi in /app/src fanno bare-import di pacchetti REALI (pdf-parse,
# exceljs, tesseract.js, pdfjs-dist). Node li risolve risalendo da /app/src:
# esponiamo la node_modules del web a /app/node_modules così sono raggiungibili.
RUN ln -s /app/web/node_modules /app/node_modules

# Chromium + dipendenze di sistema per il rendering PDF (Playwright). Eseguito da
# root (apt) prima di passare all'utente non privilegiato; i binari restano
# leggibili/eseguibili da tutti.
RUN npx playwright install --with-deps chromium \
    && chmod -R a+rx /ms-playwright \
    && rm -rf /var/lib/apt/lists/*

RUN addgroup --system appgroup && adduser --system --ingroup appgroup appuser
USER appuser

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["node", "server.js"]
