# ─── Stage 1: install dependencies ──────────────────────────────────────────
FROM node:20-alpine AS deps
WORKDIR /app

# better-sqlite3 needs native build tools
RUN apk add --no-cache python3 make g++

COPY package.json package-lock.json* ./
RUN npm ci

# ─── Stage 2: build ──────────────────────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Copy shared Electron services (used directly by API routes)
COPY ../src/main/services ./src/main/services

ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# ─── Stage 3: production runner ──────────────────────────────────────────────
FROM node:20-alpine AS runner
WORKDIR /app

RUN apk add --no-cache python3 make g++
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Standalone Next.js output
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

# Native modules need to be re-built or copied pre-built
COPY --from=deps /app/node_modules ./node_modules

# Electron shared services
COPY --from=builder /app/src ./src

RUN mkdir -p /data && chown appuser:appgroup /data
USER appuser

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["node", "server.js"]
