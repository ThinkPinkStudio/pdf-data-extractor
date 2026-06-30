# Orchestratore batch — container a sé (build context = ./worker)
#   docker build -t pdf-extractor-worker ./worker
#   docker run --env-file worker/.env -v /data:/data --restart unless-stopped pdf-extractor-worker
# Comando di default = loop autonomo ("work"). Per la discovery: ... pdf-extractor-worker scan
FROM node:20-alpine

WORKDIR /app

COPY package.json ./
RUN npm install --no-audit --no-fund

COPY . .

ENV NODE_ENV=production

# Loop autonomo, sequenziale; sopravvive all'abbandono sessione.
# Usare --restart unless-stopped a runtime per la ripresa dopo crash/riavvio.
CMD ["npx", "tsx", "src/index.ts", "work"]
