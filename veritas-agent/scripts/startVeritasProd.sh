#!/bin/sh
set -e

# Add and enable VeritasAI repository
ploinky add repo veritasAI https://github.com/PloinkyRepos/VeritasAI
ploinky enable repo veritasAI

# OpenAI API Key
ploinky var OPENAI_API_KEY "sk-01234567890123456789012345678901"

# ============================================================================
# PostgreSQL Configuration
# ============================================================================
DB_PASSWORD="your-secure-postgres-password"

ploinky var POSTGRES_USER "keycloak"
ploinky var POSTGRES_PASSWORD "${DB_PASSWORD}"
ploinky var POSTGRES_DB "keycloak"


# ============================================================================
# Keycloak Database Connection
# ============================================================================
# Determine the host IP based on container runtime
if command -v docker >/dev/null 2>&1; then
    # Docker Desktop exposes host services at host.docker.internal.
    # Uncomment for native Docker on Linux: DB_HOST="172.17.0.1"
    DB_HOST="host.docker.internal"
elif command -v podman >/dev/null 2>&1; then
    # Podman forwards host services through host.containers.internal.
    DB_HOST="host.containers.internal"
else
    DB_HOST="localhost"
fi

# Keycloak Database Connection String
# PostgreSQL will be accessible via the host's published port 5432
ploinky var SSO_DB_ENGINE "postgres"
ploinky var SSO_DB_URL "jdbc:postgresql://${DB_HOST}:5432/keycloak"
ploinky var SSO_DB_USERNAME "keycloak"
ploinky var SSO_DB_PASSWORD "${DB_PASSWORD}"

# ============================================================================
# Keycloak SSO Configuration
# ============================================================================
# Base URL - Keycloak server URL
ploinky var SSO_BASE_URL "https://sso.axiologic.dev"

# Realm - Keycloak realm name (customize as needed)
ploinky var SSO_REALM "ploinky"

# Client ID - Application identifier in Keycloak (customize as needed)
ploinky var SSO_CLIENT_ID "ploinky-router"

# Client Secret - Client secret from Keycloak (required for confidential clients)
ploinky var SSO_CLIENT_SECRET "your-client-secret-here"

# OAuth2 Scope - Default is 'openid profile email'
ploinky var SSO_SCOPE "openid profile email"

# Redirect URI - OAuth callback URL for the application
ploinky var SSO_REDIRECT_URI "https://veritas.axiologic.dev/auth/callback"

# Logout Redirect URI - Where to redirect after logout
ploinky var SSO_LOGOUT_REDIRECT_URI "https://veritas.axiologic.dev"

# Keycloak Admin Credentials (optional, for administrative operations)
ploinky var SSO_ADMIN "admin"
ploinky var SSO_ADMIN_PASSWORD "your-admin-password-here"

# Keycloak hostname configuration for Cloudflare Tunnel
ploinky var SSO_HOSTNAME "sso.axiologic.dev"
ploinky var SSO_HOSTNAME_STRICT "false"
ploinky var SSO_HTTP_ENABLED "true"
ploinky var SSO_PROXY "edge"

# Optional: Production security enhancements
# ploinky var SSO_HOSTNAME_STRICT "true"  # Enable after initial setup
# ploinky var KC_HEALTH_ENABLED "true"    # Enable health checks
# ploinky var KC_METRICS_ENABLED "true"   # Enable metrics endpoint

# Enable and start Keycloak agent
ploinky enable agent keycloak

# Enable SSO
ploinky sso enable

# Start the Veritas agent
ploinky start veritas-agent

CID=$(podman ps -q -f name=keycloak)

podman exec -u 0 -it $CID sh -lc '
  mkdir -p /opt/keycloak/data/tmp &&
  chown -R 1000:0 /opt/keycloak/data
'
