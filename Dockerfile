FROM oven/bun:alpine

WORKDIR /app

# Copy package manifests
COPY package.json bun.lock* ./

# Install dependencies
RUN bun install --frozen-lockfile

# Copy application source and web assets
COPY src/ ./src/
COPY public/ ./public/
COPY tsconfig.json ./

# Create data directory for SQLite persistence
RUN mkdir -p /app/data

# Environment configuration
ENV HOST=0.0.0.0
ENV PORT=8340
ENV DB_PATH=/app/data/proxies.db
ENV CONCURRENCY_LIMIT=30
ENV MAINTENANCE_INTERVAL_MINUTES=3

EXPOSE 8340

# Built-in health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:8340/api/stats || exit 1

CMD ["bun", "run", "src/index.ts"]
