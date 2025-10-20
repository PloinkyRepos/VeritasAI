#!/bin/sh
set -eu
SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
. "$SCRIPT_DIR/setEnv.sh"
# Export Keycloak users, their credentials, and assigned roles.
# Requires admin access (same env vars used by configure-keycloak-realm.sh).
# Output defaults to stdout, or provide a file path as the first argument.

usage() {
    cat <<'EOF'
Usage: export-keycloak-users.sh [output.json]

Environment variables (first non-empty value is used):
  Base URL:       KEYCLOAK_URL | SSO_BASE_URL | SSO_URL | OIDC_BASE_URL
  Admin user:     KEYCLOAK_ADMIN | SSO_ADMIN | OIDC_ADMIN
  Admin password: KEYCLOAK_ADMIN_PASSWORD | SSO_ADMIN_PASSWORD | OIDC_ADMIN_PASSWORD
  Realm:          KEYCLOAK_REALM | SSO_REALM | OIDC_REALM   (defaults to "ploinky")

Notes:
  • Output defaults to ./keycloak-users-export.json unless a path is provided.
  • Credentials returned by the admin API are hashed/metadata only (no raw passwords).
  • The script calls the Keycloak Admin REST API, mirroring what the admin console does.
EOF
}

resolve_env() {
    for name in "$@"; do
        eval "value=\${$name:-}"
        if [ -n "$value" ]; then
            printf '%s' "$value"
            return 0
        fi
    done
    return 1
}

log() {
    printf '[export-keycloak-users] %s\n' "$*" >&2
}

if [ "${1:-}" = "-h" ] || [ "${1:-}" = "--help" ]; then
    usage
    exit 0
fi

for binary in jq curl python3; do
    if ! command -v "$binary" >/dev/null 2>&1; then
        log "Required dependency not found: $binary"
        exit 1
    fi
done

OUTPUT_PATH="${1:-keycloak-users-export.json}"

BASE_URL="$(resolve_env KEYCLOAK_URL SSO_BASE_URL SSO_URL OIDC_BASE_URL || true)"
ADMIN_USER="$(resolve_env KEYCLOAK_ADMIN SSO_ADMIN OIDC_ADMIN || true)"
ADMIN_PASS="$(resolve_env KEYCLOAK_ADMIN_PASSWORD SSO_ADMIN_PASSWORD OIDC_ADMIN_PASSWORD || true)"
REALM_NAME="$(resolve_env KEYCLOAK_REALM SSO_REALM OIDC_REALM || true)"

if [ -z "${BASE_URL:-}" ] || [ -z "${ADMIN_USER:-}" ] || [ -z "${ADMIN_PASS:-}" ]; then
    log "Missing required environment variables (base URL, admin user, admin password)."
    usage
    exit 1
fi

BASE_URL="${BASE_URL%/}"
REALM_NAME="${REALM_NAME:-ploinky}"

token_response="$(curl -sS --fail -X POST \
    -H 'Content-Type: application/x-www-form-urlencoded' \
    -d "username=${ADMIN_USER}" \
    -d "password=${ADMIN_PASS}" \
    -d 'grant_type=password' \
    -d 'client_id=admin-cli' \
    "${BASE_URL}/realms/master/protocol/openid-connect/token" || true)"

if [ -z "$token_response" ]; then
    log "Failed to obtain admin access token from Keycloak."
    exit 1
fi

ACCESS_TOKEN="$(printf '%s' "$token_response" | jq -r '.access_token // empty')"
if [ -z "$ACCESS_TOKEN" ] || [ "$ACCESS_TOKEN" = "null" ]; then
    error_desc="$(printf '%s' "$token_response" | jq -r '.error_description // .error // empty')"
    log "Admin authentication failed. ${error_desc}"
    exit 1
fi

OUTPUT_ARG="${OUTPUT_PATH}"

python3 - "$BASE_URL" "$REALM_NAME" "$ACCESS_TOKEN" "$OUTPUT_ARG" <<'PY'
import json
import sys
import urllib.parse
import urllib.request
import urllib.error
from datetime import datetime, timezone

base_url, realm, token, output = sys.argv[1:5]

def api_get(path, params=None):
    if params:
        query = urllib.parse.urlencode(params, doseq=True)
        url = f"{base_url}{path}?{query}"
    else:
        url = f"{base_url}{path}"
    req = urllib.request.Request(url, headers={
        "Authorization": f"Bearer {token}",
        "Accept": "application/json"
    })
    try:
        with urllib.request.urlopen(req) as resp:
            data = resp.read()
            if not data:
                return None
            return json.loads(data.decode())
    except urllib.error.HTTPError as exc:
        body = exc.read().decode(errors="ignore")
        raise RuntimeError(f"HTTP {exc.code} for {path}: {body}") from exc

users = []
page_size = 100
first = 0
while True:
    chunk = api_get(f"/admin/realms/{realm}/users", {"first": first, "max": page_size})
    if not chunk:
        break
    users.extend(chunk)
    if len(chunk) < page_size:
        break
    first += len(chunk)

exported_users = []
for user in users:
    user_id = user.get("id")
    if not user_id:
        continue
    role_mappings = api_get(f"/admin/realms/{realm}/users/{user_id}/role-mappings") or {}
    credentials = api_get(f"/admin/realms/{realm}/users/{user_id}/credentials") or []
    groups = api_get(f"/admin/realms/{realm}/users/{user_id}/groups") or []

    realm_roles = []
    client_roles = {}

    for mapping in role_mappings.get("realmMappings", []) or []:
        name = mapping.get("name")
        if name:
            realm_roles.append(name)

    client_map = role_mappings.get("clientMappings") or {}
    for client_id, client_info in client_map.items():
        mappings = client_info.get("mappings") or []
        names = [m.get("name") for m in mappings if m.get("name")]
        if names:
            client_roles[client_info.get("client") or client_id] = names

    exported_users.append({
        "id": user_id,
        "username": user.get("username"),
        "email": user.get("email"),
        "enabled": user.get("enabled"),
        "firstName": user.get("firstName"),
        "lastName": user.get("lastName"),
        "attributes": user.get("attributes") or {},
        "realmRoles": sorted(set(realm_roles)),
        "clientRoles": client_roles,
        "groups": [grp.get("name") for grp in groups if grp.get("name")],
        "credentials": credentials
    })

export_doc = {
    "realm": realm,
    "exportedAt": datetime.now(timezone.utc).isoformat(),
    "userCount": len(exported_users),
    "users": exported_users
}

serialized = json.dumps(export_doc, indent=2)
with open(output, "w", encoding="utf-8") as f:
    f.write(serialized)
sys.stderr.write(f"[export-keycloak-users] Wrote {len(exported_users)} users to {output}\n")
PY
