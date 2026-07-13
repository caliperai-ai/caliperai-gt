#!/bin/sh
# Regenerate /brand-config.js from BRAND_* env vars on container startup.
#
# nginx:alpine's entrypoint runs every /docker-entrypoint.d/*.sh before starting
# nginx, so this fires on every `docker compose up -d frontend`. That is what
# makes branding a RUNTIME switch (env change + recreate) with no image rebuild.
#
# Env (all optional; CaliperGT defaults):
#   BRAND_NAME     product name shown in the UI   (default "CaliperGT")
#   BRAND_COMPANY  legal/company name             (default "Caliper AI")
#   BRAND_LOGO     "none" => text instead of logo (default "" => show logo)
set -eu

BRAND_NAME="${BRAND_NAME:-CaliperGT}"
BRAND_COMPANY="${BRAND_COMPANY:-Caliper AI}"
BRAND_LOGO="${BRAND_LOGO:-}"

if [ "$BRAND_LOGO" = "none" ]; then
  SHOW_LOGO="false"
else
  SHOW_LOGO="true"
fi

# Escape backslashes and double-quotes so brand names can't break the JS string.
esc() { printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g'; }

# The container root fs is read-only; /var/brand is a writable tmpfs mount that
# nginx serves at /brand-config.js (see the exact-match location in nginx.proxy.conf).
mkdir -p /var/brand
OUT="/var/brand/brand-config.js"
cat > "$OUT" <<EOF
// Generated at container startup from BRAND_* env. Do not edit by hand.
window.__BRAND__ = {
  name: "$(esc "$BRAND_NAME")",
  company: "$(esc "$BRAND_COMPANY")",
  showLogo: ${SHOW_LOGO},
};
EOF

echo "[10-brand] brand-config.js -> name='${BRAND_NAME}' company='${BRAND_COMPANY}' showLogo=${SHOW_LOGO}"
