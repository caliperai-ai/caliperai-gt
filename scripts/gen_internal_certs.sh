#!/usr/bin/env bash
# =============================================================================
# gen_internal_certs.sh – Generate / Rotate Internal Service TLS Certificates
# =============================================================================
#
# Generates a self-signed CA and server certificates for each internal service
# (PostgreSQL, Redis, MinIO) that requires in-transit TLS.
#
# Layout written to CERTS_DIR (default: ./certs):
#
#   certs/
#   ├── ca.key              private key for the internal CA  (keep secret)
#   ├── ca.crt              CA certificate shared with all clients
#   ├── postgres/
#   │   ├── server.key      PostgreSQL server private key
#   │   └── server.crt      PostgreSQL server certificate (signed by CA)
#   ├── redis/
#   │   ├── server.key      Redis server private key
#   │   └── server.crt      Redis server certificate (signed by CA)
#   └── minio/
#       ├── private.key     MinIO server private key   (MinIO naming convention)
#       └── public.crt      MinIO server certificate   (MinIO naming convention)
#
# Usage:
#   # Initial generation
#   ./scripts/gen_internal_certs.sh
#
#   # Rotate all certs (regenerates CA + all service certs)
#   ./scripts/gen_internal_certs.sh --rotate
#
#   # Use a custom output directory
#   CERTS_DIR=/etc/calipergt/certs ./scripts/gen_internal_certs.sh
#
#   # Custom validity (days)
#   CA_DAYS=3650 CERT_DAYS=365 ./scripts/gen_internal_certs.sh
#
# After running, populate the `internal_certs` Docker volume:
#   docker volume create internal_certs
#   docker run --rm -v internal_certs:/dest -v "$(pwd)/certs":/src \
#     busybox sh -c "cp -r /src/. /dest/"
#   # Fix postgres key permissions (postgres user inside container, uid 70)
#   docker run --rm -v internal_certs:/certs busybox \
#     sh -c "chmod 600 /certs/postgres/server.key && chown 70:70 /certs/postgres/server.key"
#
# Rotation (zero-downtime):
#   1. Run this script with --rotate to generate new certs in CERTS_DIR.
#   2. Copy new certs into the Docker volume (commands above).
#   3. Send SIGHUP to postgres / redis / minio containers to reload (or restart).
#      For PostgreSQL: SELECT pg_reload_conf();
#      For Redis:      docker exec anno-redis redis-cli -a $REDIS_PASSWORD --tls ... CONFIG REWRITE
#      For MinIO:      restart the container (it reloads certs on start).
# =============================================================================

set -euo pipefail

# ---------------------------------------------------------------------------
# Config (override via environment variables)
# ---------------------------------------------------------------------------
CERTS_DIR="${CERTS_DIR:-$(cd "$(dirname "$0")/.." && pwd)/certs}"
CA_DAYS="${CA_DAYS:-3650}"   # 10 years for internal CA
CERT_DAYS="${CERT_DAYS:-730}" # 2 years for service certs
KEY_BITS="${KEY_BITS:-4096}"
ROTATE="${1:-}"              # pass --rotate to force regeneration

# Subject fields
COUNTRY="${CERT_COUNTRY:-US}"
STATE="${CERT_STATE:-California}"
ORG="${CERT_ORG:-CaliperGT}"

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
info()    { echo "[INFO ]  $*"; }
warn()    { echo "[WARN ]  $*" >&2; }
success() { echo "[OK   ]  $*"; }

require_cmd() {
  if ! command -v "$1" &>/dev/null; then
    echo "[ERROR] Required command not found: $1" >&2
    exit 1
  fi
}

require_cmd openssl

# Guard against accidental CA overwrite
if [[ -f "$CERTS_DIR/ca.crt" && "$ROTATE" != "--rotate" ]]; then
  warn "Certs already exist in $CERTS_DIR."
  warn "Run with --rotate to regenerate (this will rotate all service certs)."
  exit 0
fi

mkdir -p \
  "$CERTS_DIR" \
  "$CERTS_DIR/postgres" \
  "$CERTS_DIR/redis" \
  "$CERTS_DIR/minio"

# ---------------------------------------------------------------------------
# 1. Internal Certificate Authority
# ---------------------------------------------------------------------------
info "Generating internal CA key ($KEY_BITS bits, valid $CA_DAYS days)…"
openssl genrsa -out "$CERTS_DIR/ca.key" "$KEY_BITS"
chmod 600 "$CERTS_DIR/ca.key"

openssl req -x509 -new -nodes \
  -key "$CERTS_DIR/ca.key" \
  -sha256 \
  -days "$CA_DAYS" \
  -out "$CERTS_DIR/ca.crt" \
  -subj "/C=$COUNTRY/ST=$STATE/O=$ORG/CN=CaliperGT-Internal-CA"

success "CA certificate: $CERTS_DIR/ca.crt"

# ---------------------------------------------------------------------------
# Helper – generate a service certificate signed by our CA
# ---------------------------------------------------------------------------
# Args: <service_name> <CN> <SAN-csv> <out_key> <out_crt>
gen_service_cert() {
  local svc="$1"
  local cn="$2"
  local san_csv="$3"   # e.g. "DNS:postgres,DNS:localhost,IP:127.0.0.1"
  local out_key="$4"
  local out_crt="$5"

  info "Generating $svc server key…"
  openssl genrsa -out "$out_key" "$KEY_BITS"
  chmod 600 "$out_key"

  # Build a temporary OpenSSL config with SANs
  local tmpconf
  tmpconf=$(mktemp /tmp/openssl_ext_XXXXXX.cnf)
  cat > "$tmpconf" <<EOF
[req]
req_extensions = v3_req
distinguished_name = req_distinguished_name

[req_distinguished_name]

[v3_req]
subjectAltName = $san_csv
keyUsage = digitalSignature, keyEncipherment
extendedKeyUsage = serverAuth
EOF

  info "Generating $svc CSR…"
  openssl req -new -key "$out_key" \
    -out "${out_key%.key}.csr" \
    -subj "/C=$COUNTRY/ST=$STATE/O=$ORG/CN=$cn" \
    -config "$tmpconf"

  info "Signing $svc certificate (valid $CERT_DAYS days)…"
  openssl x509 -req \
    -in "${out_key%.key}.csr" \
    -CA "$CERTS_DIR/ca.crt" \
    -CAkey "$CERTS_DIR/ca.key" \
    -CAcreateserial \
    -out "$out_crt" \
    -days "$CERT_DAYS" \
    -sha256 \
    -extfile "$tmpconf" \
    -extensions v3_req

  rm -f "${out_key%.key}.csr" "$tmpconf"
  success "$svc cert: $out_crt"
}

# ---------------------------------------------------------------------------
# 2. PostgreSQL
# ---------------------------------------------------------------------------
gen_service_cert \
  "PostgreSQL" \
  "postgres" \
  "DNS:postgres,DNS:anno-postgres,DNS:localhost,IP:127.0.0.1" \
  "$CERTS_DIR/postgres/server.key" \
  "$CERTS_DIR/postgres/server.crt"

# PostgreSQL requires the private key to be owned by the postgres user (UID 70
# inside the postgres:alpine image) and not readable by others.
# The Docker volume copy step in the header comment sets these permissions.
chmod 600 "$CERTS_DIR/postgres/server.key"

# ---------------------------------------------------------------------------
# 3. Redis
# ---------------------------------------------------------------------------
gen_service_cert \
  "Redis" \
  "redis" \
  "DNS:redis,DNS:anno-redis,DNS:localhost,IP:127.0.0.1" \
  "$CERTS_DIR/redis/server.key" \
  "$CERTS_DIR/redis/server.crt"

# ---------------------------------------------------------------------------
# 4. MinIO (MinIO expects files named public.crt / private.key)
# ---------------------------------------------------------------------------
gen_service_cert \
  "MinIO" \
  "minio" \
  "DNS:minio,DNS:anno-minio,DNS:localhost,IP:127.0.0.1" \
  "$CERTS_DIR/minio/private.key" \
  "$CERTS_DIR/minio/public.crt"

# ---------------------------------------------------------------------------
# Done – print summary
# ---------------------------------------------------------------------------
cat <<SUMMARY

=============================================================================
 Internal TLS certificates generated in: $CERTS_DIR
=============================================================================
 CA cert:           $CERTS_DIR/ca.crt       (validity: $CA_DAYS days)
 PostgreSQL cert:   $CERTS_DIR/postgres/server.crt
 Redis cert:        $CERTS_DIR/redis/server.crt
 MinIO cert:        $CERTS_DIR/minio/public.crt
 Service validity:  $CERT_DAYS days

 Next steps:
   1. Populate the Docker volume (see header comment for commands).
   2. Set in .env:
        DB_SSL_MODE=require
        DB_SSL_CA=/certs/ca.crt
        REDIS_TLS_ENABLED=true
        REDIS_TLS_CA=/certs/ca.crt
        MINIO_TLS_CA=/certs/ca.crt
        OBJECT_STORAGE_ENDPOINT=https://minio:9000
   3. Restart services: docker compose -f docker-compose.prod.yml up -d

 Rotation reminder: service certs expire in $CERT_DAYS days.
   Re-run this script with --rotate before expiry.
=============================================================================
SUMMARY
