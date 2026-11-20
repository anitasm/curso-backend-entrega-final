FROM node:24.22.3-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY src/ ./src/
ENV NODE_ENV=production PORT=8080
RUN mkdir -p /app/uploads /app/src/public/img/uploads /app/logs \
    && chown -R node:node /app/uploads /app/src/public/img/uploads /app/logs
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 CMD ["node", "src/healthcheck.js"]
CMD ["node", "src/server.js"]
