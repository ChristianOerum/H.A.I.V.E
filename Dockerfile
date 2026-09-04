# syntax=docker/dockerfile:1
#
# This image IS the Home Assistant add-on (see haive/config.yaml `image:`).
# Supervisor pulls it directly — no on-device build — so publishing a new tag
# with deploy/publish-image.sh|ps1 and bumping haive/config.yaml `version` is
# the entire update.

# ── Build stage ───────────────────────────────────────────────
FROM node:22-alpine AS builder
WORKDIR /app

# Install dependencies first for better layer caching.
COPY package*.json ./
RUN npm ci

# Build the Nuxt app (produces .output/).
COPY . .
RUN npm run build

# ── Runtime stage ─────────────────────────────────────────────
# Node 22 is required: the server bridges browsers to Home Assistant using the
# global WebSocket client.
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000

# The compiled server + its node_modules are self-contained in .output.
COPY --from=builder /app/.output ./.output
# Default config, seeded into the add-on's persistent /data on first start.
COPY --from=builder /app/config ./config.default
COPY run.sh /run.sh
RUN chmod +x /run.sh

ARG BUILD_VERSION=0.0.0
ARG TARGETARCH
LABEL \
  io.hass.version="${BUILD_VERSION}" \
  io.hass.type="app" \
  io.hass.arch="${TARGETARCH}"

EXPOSE 3000
CMD ["/run.sh"]
