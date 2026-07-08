# syntax=docker/dockerfile:1

# ── Build stage ───────────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app

# Install dependencies first for better layer caching.
COPY package*.json ./
RUN npm ci

# Build the Nuxt app (produces .output/).
COPY . .
RUN npm run build

# ── Runtime stage ─────────────────────────────────────────────
FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0

# The compiled server + its node_modules are self-contained in .output.
COPY --from=builder /app/.output ./.output
# Ship the default config so a fresh volume can be seeded on first boot.
COPY --from=builder /app/config ./config.default
COPY deploy/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

EXPOSE 3000
VOLUME ["/app/config"]

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", ".output/server/index.mjs"]
