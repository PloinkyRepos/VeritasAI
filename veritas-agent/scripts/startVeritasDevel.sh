#!/bin/sh
set -eu

ploinky add repo veritasAI https://github.com/OutfinityResearch/VeritasAI
ploinky enable repo veritasAI

ploinky var OPENAI_API_KEY "sk-01234567890123456789012345678901"

# ============================================================================
# PostgreSQL Configuration
# ============================================================================
DB_PASSWORD="admin"

ploinky var POSTGRES_USER "keycloak"
ploinky var POSTGRES_PASSWORD "${DB_PASSWORD}"
ploinky var POSTGRES_DB "keycloak"
# Use a dev-specific PGDATA to avoid clashing with previous clusters/passwords
ploinky var PGDATA "/var/lib/postgresql/data/pgdata-dev"


# ============================================================================
# Keycloak Database Connection
# ============================================================================
# Determine the host IP based on container runtime
# Determine the database host for Keycloak
if [ -n "${VERITAS_DB_HOST:-}" ]; then
  DB_HOST="${VERITAS_DB_HOST}"
elif command -v docker >/dev/null 2>&1 && ! command -v podman >/dev/null 2>&1; then
  # Docker: use host gateway DNS name
  DB_HOST="host.docker.internal"
elif command -v podman >/dev/null 2>&1; then
  # Podman: use host gateway DNS name
  DB_HOST="host.containers.internal"
else
  DB_HOST="localhost"
fi

ploinky var SSO_DB_ENGINE "postgres"
ploinky var SSO_DB_URL "jdbc:postgresql://${DB_HOST}:5432/keycloak"
ploinky var SSO_DB_USERNAME "keycloak"
ploinky var SSO_DB_PASSWORD "${DB_PASSWORD}"

# ============================================================================
# Keycloak SSO Configuration
# ============================================================================
# Base URL - Keycloak server URL
ploinky var SSO_BASE_URL "http://127.0.0.1:9090"

# Realm - Keycloak realm name (customize as needed)
ploinky var SSO_REALM "ploinky"

# Client ID - Application identifier in Keycloak (customize as needed)
ploinky var SSO_CLIENT_ID "ploinky-router"

# OAuth2 Scope - Default is 'openid profile email'
ploinky var SSO_SCOPE "openid profile email"

# Redirect URI - OAuth callback URL for the application
ploinky var SSO_REDIRECT_URI "http://127.0.0.1:8080/auth/callback"

# Logout Redirect URI - Where to redirect after logout
ploinky var SSO_LOGOUT_REDIRECT_URI "http://127.0.0.1:8080"

# Keycloak Admin Credentials (optional, for administrative operations)
ploinky var SSO_ADMIN "admin"
ploinky var SSO_ADMIN_PASSWORD "admin"

ploinky sso enable
ploinky start veritas-agent

# Podman-specific: ensure Keycloak data dir permissions are correct
if command -v podman >/dev/null 2>&1; then
  CID=$(podman ps -q -f name=keycloak)
  if [ -n "$CID" ]; then
    podman exec -u 0 -it "$CID" sh -lc 'mkdir -p /opt/keycloak/data/tmp && chown -R 1000:0 /opt/keycloak/data' || true
  fi
fi
