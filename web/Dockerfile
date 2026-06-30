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

# ─── Stage 1: install web dependencies ───────────────────────────────────────
FROM node:20-alpine AS deps
WORKDIR /app/web

COPY web/package.json web/package-lock.json* ./
# Lo shim locale `electron` (file:shims/electron) deve esistere PRIMA di npm ci,
# altrimenti l'installazione della dipendenza file: fallisce.
COPY web/shims ./shims
# --include=dev forces devDependencies (typescript, @types/*) to install even when
# the builder sets NODE_ENV=production — next build needs them.
RUN npm ci --include=dev

# ─── Stage 2: build the Next.js web app ──────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app/web

COPY --from=deps /app/web/node_modules ./node_modules

# Web app sources
COPY web ./

# Shared Electron services used directly by the web API routes
COPY src/main/services /app/src/main/services

# Lingua OCR Tesseract (estrazione polizze scansionate offline). Lo shim
# electron (web/shims/electron) cerca ita.traineddata partendo da cwd/.. → /app.
COPY ita.traineddata /app/ita.traineddata

ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# ─── Stage 3: production runner ──────────────────────────────────────────────
FROM node:20-alpine AS runner
WORKDIR /app/web

RUN addgroup -S appgroup && adduser -S appuser -G appgroup

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Standalone Next.js output
COPY --from=builder /app/web/.next/standalone ./
COPY --from=builder /app/web/.next/static ./.next/static
COPY --from=builder /app/web/public ./public

# pg/nodemailer are pure JS — no native rebuild needed
COPY --from=deps /app/web/node_modules ./node_modules

# Shared Electron services (kept at /app/src so cwd/../src/main/services resolves)
COPY --from=builder /app/src /app/src
COPY --from=builder /app/ita.traineddata /app/ita.traineddata

# I servizi condivisi in /app/src fanno bare-import (electron shim, pdf-parse,
# exceljs, tesseract.js, pdfjs-dist…). Node li risolve risalendo da /app/src:
# esponiamo la node_modules del web a /app/node_modules così quei moduli (incluso
# lo shim `electron` in web/node_modules) sono raggiungibili anche da /app/src.
RUN ln -s /app/web/node_modules /app/node_modules

USER appuser

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["node", "server.js"]
