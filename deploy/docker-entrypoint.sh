#!/bin/sh
# Seed the persistent config volume with default data on first boot, then run
# the server. Existing files in the volume are never overwritten, so user data
# (device.json, edited entities.json/floorplan.json) survives image updates.
set -e

mkdir -p /app/config

if [ -d /app/config.default ]; then
  for src in $(find /app/config.default -type f); do
    dest="/app/config/${src#/app/config.default/}"
    if [ ! -f "$dest" ]; then
      mkdir -p "$(dirname "$dest")"
      cp "$src" "$dest"
    fi
  done
fi

exec "$@"
