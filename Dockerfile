# Immagine per il deploy su PaaS (Render, Railway, Fly.io, Koyeb...).
# Il database è esterno: passa DATABASE_URL (e le altre variabili di
# .env.example) dal pannello del servizio.
FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY server ./server
COPY HTML ./HTML

USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD wget -qO- http://127.0.0.1:${PORT:-3000}/api/health || exit 1

CMD ["node", "server/src/index.js"]
