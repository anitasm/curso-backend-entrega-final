FROM node:24.22.3-bookworm-slim AS base
WORKDIR /app
COPY package.json package-lock.json ./

FROM base AS prod-deps
RUN npm ci --omit=dev && npm cache clean --force

FROM base AS test
RUN npm ci && npm cache clean --force
COPY src/ ./src/
COPY test/ ./test/
COPY tests/ ./tests/
COPY scripts/ ./scripts/
RUN mkdir -p /app/uploads /app/src/public/img/uploads /app/logs && chown -R node:node /app
USER node
CMD ["npm", "run", "test:integration:inside"]

FROM base AS runtime
COPY --from=prod-deps /app/node_modules ./node_modules
COPY src/ ./src/
ENV NODE_ENV=production PORT=8080
RUN mkdir -p /app/uploads /app/src/public/img/uploads /app/logs \
    && chown -R node:node /app/uploads /app/src/public/img/uploads /app/logs
USER node
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=5s --start-period=60s --retries=6 CMD ["node", "src/healthcheck.js"]
CMD ["node", "src/server.js"]
