# Ретранслятор совместной работы Abax. Сборка: docker build -t abax-relay relay/
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY protocol.cjs server.cjs index.cjs ./
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD wget -qO- "http://127.0.0.1:${PORT:-8080}/health" > /dev/null || exit 1
CMD ["node", "index.cjs"]
