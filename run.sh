#!/bin/sh
# Home Assistant OS add-on entrypoint.
#
# The Supervisor gives every add-on a persistent /data directory, so the server
# is started with /data as its working directory and HAIVE's config therefore
# lands in /data/config — surviving add-on updates and restarts.
#
# Home Assistant itself needs no configuration: the Supervisor injects
# SUPERVISOR_TOKEN, which the server uses to reach Core at http://supervisor/core.
set -e

mkdir -p /data/config

# Seed defaults on first start. Existing files are never overwritten.
if [ -d /app/config.default ]; then
  find /app/config.default -type f | while read -r src; do
    dest="/data/config/${src#/app/config.default/}"
    if [ ! -f "$dest" ]; then
      mkdir -p "$(dirname "$dest")"
      cp "$src" "$dest"
    fi
  done
fi

cd /data
exec node /app/.output/server/index.mjs
