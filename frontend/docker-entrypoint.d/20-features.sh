#!/bin/sh
# Regenerate /feature-config.js from FEATURE_* env vars on container startup.
#
# Same mechanism as 10-brand.sh: nginx:alpine runs every /docker-entrypoint.d/*.sh
# before starting nginx, so this fires on every `docker compose up -d frontend`.
# That makes feature gating a RUNTIME switch (env change + recreate) with NO rebuild.
#
# Convention: an env var FEATURE_<NAME> maps to feature key "<name>" (lowercased).
#   FEATURE_PM_DASHBOARD=off  ->  window.__FEATURES__.pm_dashboard = false
#   FEATURE_CHAT=off          ->  window.__FEATURES__.chat        = false
# A feature is disabled only when its value is off/false/0/no (case-insensitive).
# Anything else (including unset/empty) leaves it ON — the default in
# src/config/features.ts.
set -eu

# The container root fs is read-only; /var/brand is a writable tmpfs mount that
# nginx also serves /brand-config.js from (see nginx.proxy.conf).
mkdir -p /var/brand
OUT="/var/brand/feature-config.js"

{
  echo "// Generated at container startup from FEATURE_* env. Do not edit by hand."
  echo "window.__FEATURES__ = {"
  # Iterate FEATURE_* env vars; values are simple tokens (no spaces).
  env | grep '^FEATURE_' | sort | while IFS='=' read -r name val; do
    key=$(printf '%s' "${name#FEATURE_}" | tr '[:upper:]' '[:lower:]')
    case "$val" in
      [Oo][Ff][Ff]|[Ff][Aa][Ll][Ss][Ee]|0|[Nn][Oo]) echo "  \"$key\": false,";;
      "") : ;;  # empty => leave at default (on); emit nothing
      *) echo "  \"$key\": true,";;
    esac
  done
  echo "};"
} > "$OUT"

echo "[20-features] feature-config.js regenerated from FEATURE_* env"
