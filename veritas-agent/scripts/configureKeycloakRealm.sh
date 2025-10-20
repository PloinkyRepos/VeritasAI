#!/bin/sh
set -eu
SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
. "$SCRIPT_DIR/setEnv.sh"
echo "KEYCLOAK_URL: $KEYCLOAK_URL"
echo "KEYCLOAK_ADMIN: $KEYCLOAK_ADMIN"
echo "KEYCLOAK_ADMIN_PASSWORD: $KEYCLOAK_ADMIN_PASSWORD"
echo "KEYCLOAK_REALM: $KEYCLOAK_REALM"
echo "KEYCLOAK_CLIENT_ID: $KEYCLOAK_CLIENT_ID"
# Configure a Keycloak realm using an export file.
# The script expects Keycloak admin credentials and realm
# metadata to be provided via environment variables. It will
# generate a fresh client secret, inject it into the realm
# export, and apply the configuration through the admin API.

usage() {
    cat <<'EOF'
Usage: configure-keycloak-realm.sh [--realm <file>] [--user <file> ...]

Environment variables (first non-empty value is used):
  Base URL:           KEYCLOAK_URL | SSO_BASE_URL | SSO_URL | OIDC_BASE_URL
  Admin username:     KEYCLOAK_ADMIN | SSO_ADMIN | OIDC_ADMIN
  Admin password:     KEYCLOAK_ADMIN_PASSWORD | SSO_ADMIN_PASSWORD | OIDC_ADMIN_PASSWORD
  Target realm:       KEYCLOAK_REALM | SSO_REALM | OIDC_REALM   (defaults to "ploinky")
  OAuth client ID:    KEYCLOAK_CLIENT_ID | SSO_CLIENT_ID | OIDC_CLIENT_ID

Optional:
  REALM_EXPORT_PATH   Default realm export file when --realm is omitted

Flags:
  --realm <file>      Apply realm settings (client secret regenerated before import)
  --user  <file>      Import users (and credentials) via Keycloak partial import. Repeatable.

The script prints the regenerated client secret to stdout when --realm is used.
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
    printf '[configure-keycloak] %s\n' "$*" >&2
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
REALM_FILE=""
USER_FILES=""

while [ $# -gt 0 ]; do
    case "$1" in
        --realm)
            if [ $# -lt 2 ]; then
                log "Missing value for --realm"
                exit 1
            fi
            REALM_FILE="$2"
            shift 2
            ;;
        --user|--users)
            if [ $# -lt 2 ]; then
                log "Missing value for $1"
                exit 1
            fi
            USER_FILES="$USER_FILES $2"
            shift 2
            ;;
        -h|--help)
            usage
            exit 0
            ;;
        -*)
            log "Unknown option: $1"
            usage
            exit 1
            ;;
        *)
            if [ -z "$REALM_FILE" ]; then
                REALM_FILE="$1"
            else
                USER_FILES="$USER_FILES $1"
            fi
            shift
            ;;
    esac
done

if [ -z "$REALM_FILE" ] && [ -n "${REALM_EXPORT_PATH:-}" ]; then
    REALM_FILE="$REALM_EXPORT_PATH"
fi

if [ -z "$REALM_FILE" ] && [ -z "$USER_FILES" ]; then
    if [ -f "realm-export.json" ]; then
        REALM_FILE="realm-export.json"
    else
        log "No input files provided. Use --realm and/or --user."
        usage
        exit 1
    fi
fi

if [ -n "$REALM_FILE" ] && [ ! -f "$REALM_FILE" ]; then
    log "Realm export file not found: $REALM_FILE"
    exit 1
fi

for file in $USER_FILES; do
    if [ ! -f "$file" ]; then
        log "User import file not found: $file"
        exit 1
    fi
done

BASE_URL="$(resolve_env KEYCLOAK_URL SSO_BASE_URL SSO_URL OIDC_BASE_URL || true)"
ADMIN_USER="$(resolve_env KEYCLOAK_ADMIN SSO_ADMIN OIDC_ADMIN || true)"
ADMIN_PASS="$(resolve_env KEYCLOAK_ADMIN_PASSWORD SSO_ADMIN_PASSWORD OIDC_ADMIN_PASSWORD || true)"
REALM_NAME="$(resolve_env KEYCLOAK_REALM SSO_REALM OIDC_REALM || true)"
DEFAULT_USER_PASSWORD="$(resolve_env KEYCLOAK_USER_PASSWORD SSO_USER_PASSWORD OIDC_USER_PASSWORD KEYCLOAK_DEFAULT_USER_PASSWORD || true)"

if [ -z "${BASE_URL:-}" ] || [ -z "${ADMIN_USER:-}" ] || [ -z "${ADMIN_PASS:-}" ]; then
    log "Missing required environment variables."
    log "Ensure base URL, admin username, and admin password are set."
    usage
    exit 1
fi

BASE_URL="${BASE_URL%/}"
REALM_NAME="${REALM_NAME:-ploinky}"

CLIENT_ID=""
if [ -n "$REALM_FILE" ]; then
    CLIENT_ID="$(resolve_env KEYCLOAK_CLIENT_ID SSO_CLIENT_ID OIDC_CLIENT_ID || true)"
    if [ -z "${CLIENT_ID:-}" ]; then
        CLIENT_ID="$(jq -r '.clients[]?.clientId // empty' "$REALM_FILE" | head -n 1 || true)"
    fi
    if [ -z "${CLIENT_ID:-}" ]; then
        log "Unable to determine OAuth client ID from environment or realm export."
        exit 1
    fi
fi

TMP_FILES=""
cleanup() {
    for f in $TMP_FILES; do
        [ -n "$f" ] && rm -f "$f" 2>/dev/null || true
    done
}
trap cleanup EXIT

ACCESS_TOKEN=""
REFRESH_TOKEN=""

obtain_admin_token() {
    local response
    response="$(curl -sS --fail -X POST \
        -H 'Content-Type: application/x-www-form-urlencoded' \
        -d "username=${ADMIN_USER}" \
        -d "password=${ADMIN_PASS}" \
        -d 'grant_type=password' \
        -d 'client_id=admin-cli' \
        "${BASE_URL}/realms/master/protocol/openid-connect/token" || true)"

    if [ -z "$response" ]; then
        log "Failed to obtain admin access token from Keycloak."
        return 1
    fi

    local access refresh error_desc
    access="$(printf '%s' "$response" | jq -r '.access_token // empty')"
    refresh="$(printf '%s' "$response" | jq -r '.refresh_token // empty')"
    error_desc="$(printf '%s' "$response" | jq -r '.error_description // .error // empty')"

    if [ -z "$access" ] || [ "$access" = "null" ]; then
        log "Admin authentication failed. ${error_desc}"
        return 1
    fi

    ACCESS_TOKEN="$access"
    REFRESH_TOKEN="$refresh"
    return 0
}

refresh_admin_token() {
    if [ -n "$REFRESH_TOKEN" ]; then
        local response
        response="$(curl -sS --fail -X POST \
            -H 'Content-Type: application/x-www-form-urlencoded' \
            -d "grant_type=refresh_token" \
            -d "client_id=admin-cli" \
            -d "refresh_token=${REFRESH_TOKEN}" \
            "${BASE_URL}/realms/master/protocol/openid-connect/token" || true)"
        if [ -n "$response" ]; then
            local access refresh
            access="$(printf '%s' "$response" | jq -r '.access_token // empty')"
            refresh="$(printf '%s' "$response" | jq -r '.refresh_token // empty')"
            if [ -n "$access" ] && [ "$access" != "null" ]; then
                ACCESS_TOKEN="$access"
                REFRESH_TOKEN="$refresh"
                log "Admin access token refreshed."
                return 0
            fi
        fi
    fi
    log "Refreshing admin session via password grant..."
    obtain_admin_token
}

generate_secret() {
    if command -v openssl >/dev/null 2>&1; then
        openssl rand -hex 32
    else
        python3 - <<'PY'
import secrets
print(secrets.token_hex(32))
PY
    fi
}

get_existing_client_secret() {
    local realm="$1"
    local client_id="$2"
    local client_list client_uuid client_data secret
    
    # Get list of clients to find the UUID
    client_list="$(curl -sS -H "Authorization: Bearer ${ACCESS_TOKEN}" \
        -H 'Accept: application/json' \
        "${BASE_URL}/admin/realms/${realm}/clients?clientId=${client_id}" || true)"
    
    if [ -z "$client_list" ] || [ "$client_list" = "[]" ]; then
        return 1
    fi
    
    client_uuid="$(printf '%s' "$client_list" | jq -r '.[0].id // empty')"
    if [ -z "$client_uuid" ] || [ "$client_uuid" = "null" ]; then
        return 1
    fi
    
    # Get the client secret
    client_data="$(curl -sS -H "Authorization: Bearer ${ACCESS_TOKEN}" \
        -H 'Accept: application/json' \
        "${BASE_URL}/admin/realms/${realm}/clients/${client_uuid}/client-secret" || true)"
    
    if [ -z "$client_data" ]; then
        return 1
    fi
    
    secret="$(printf '%s' "$client_data" | jq -r '.value // empty')"
    if [ -n "$secret" ] && [ "$secret" != "null" ]; then
        printf '%s' "$secret"
        return 0
    fi
    
    return 1
}

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
if ! obtain_admin_token; then
    exit 1
fi

realm_status="$(curl -s -o /dev/null -w '%{http_code}' \
    -H "Authorization: Bearer ${ACCESS_TOKEN}" \
    "${BASE_URL}/admin/realms/${REALM_NAME}" || true)"

CLIENT_SECRET=""
if [ -n "$REALM_FILE" ]; then
    # Try to get existing secret first if realm exists
    if [ "$realm_status" = "200" ]; then
        EXISTING_SECRET="$(get_existing_client_secret "$REALM_NAME" "$CLIENT_ID" || true)"
        if [ -n "$EXISTING_SECRET" ]; then
            CLIENT_SECRET="$EXISTING_SECRET"
            log "Using existing client secret for '${CLIENT_ID}'."
        fi
    fi
    
    # Generate new secret only if we don't have one
    if [ -z "$CLIENT_SECRET" ]; then
        CLIENT_SECRET="$(generate_secret)"
        log "Generated new client secret for '${CLIENT_ID}'."
    fi
    TMP_EXPORT="$(mktemp -t keycloak-realm-XXXXXX.json)"
    TMP_FILES="$TMP_FILES $TMP_EXPORT"
    if ! python3 - "$REALM_FILE" "$CLIENT_ID" "$CLIENT_SECRET" "$TMP_EXPORT" <<'PY'
import json
import sys
from pathlib import Path

src, client_id, secret, dest = sys.argv[1:5]
data = json.loads(Path(src).read_text(encoding='utf-8'))
updated = False

def update(node):
    global updated
    if isinstance(node, dict):
        if node.get("clientId") == client_id:
            node["secret"] = secret
            updated = True
        for value in node.values():
            update(value)
    elif isinstance(node, list):
        for item in node:
            update(item)

update(data)
if not updated:
    sys.stderr.write(f"Client '{client_id}' not found in realm export.\n")
    sys.exit(1)

Path(dest).write_text(json.dumps(data, indent=2), encoding='utf-8')
PY
    then
        log "Failed to update realm export with generated client secret."
        exit 1
    fi
    BACKUP_PATH="${REALM_FILE}.bak"
    cp "$REALM_FILE" "$BACKUP_PATH"
    mv "$TMP_EXPORT" "$REALM_FILE"
    log "Updated realm export with new client secret (backup at ${BACKUP_PATH})."
fi

apply_realm() {
    local method="$1"
    local url="$2"
    local body_path="$3"
    local response tmp_file status

    tmp_file="$(mktemp -t keycloak-response-XXXXXX)"
    response="$(curl -sS -o "${tmp_file}" -w '%{http_code}' \
        -X "${method}" \
        -H 'Content-Type: application/json' \
        -H "Authorization: Bearer ${ACCESS_TOKEN}" \
        --data-binary "@${body_path}" \
        "${url}" || true)"
    status="$response"
    case "$status" in
        2*) ;;
        *)
            log "Keycloak API call failed (HTTP ${status}). Response:"
            sed 's/^/  /' "${tmp_file}" >&2
            rm -f "${tmp_file}"
            return 1
            ;;
    esac
    rm -f "${tmp_file}"
    return 0
}

wait_for_realm() {
    local max_attempts="${1:-60}"
    local delay_seconds="${2:-2}"
    local attempt=0
    log "Waiting for realm '${REALM_NAME}' to become available (up to $((max_attempts * delay_seconds))s)..."
    while (( attempt < max_attempts )); do
        local status
        status="$(curl -s -o /dev/null -w '%{http_code}' \
            -H "Authorization: Bearer ${ACCESS_TOKEN}" \
            "${BASE_URL}/admin/realms/${REALM_NAME}" || true)"
        if [ "$status" = "200" ]; then
            log "Realm '${REALM_NAME}' is available."
            return 0
        fi
        if [ "$status" = "401" ]; then
            log "Realm '${REALM_NAME}' check returned 401; refreshing admin session."
            if ! refresh_admin_token; then
                log "Failed to refresh admin session while waiting for realm."
                return 1
            fi
            attempt=$((attempt + 1))
            sleep "${delay_seconds}"
            continue
        fi
        attempt=$((attempt + 1))
        if (( attempt % 10 == 0 )); then
            log "Realm '${REALM_NAME}' not ready yet (HTTP ${status}), retrying..."
        fi
        sleep "${delay_seconds}"
    done
    # One last check to capture final status for logging
    local final_status
    final_status="$(curl -s -o /dev/null -w '%{http_code}' \
        -H "Authorization: Bearer ${ACCESS_TOKEN}" \
        "${BASE_URL}/admin/realms/${REALM_NAME}" || true)"
    if [ "$final_status" = "200" ]; then
        log "Realm '${REALM_NAME}' is available."
        return 0
    fi
    log "Realm '${REALM_NAME}' still not ready (last HTTP ${final_status})."
    return 1
}

ensure_realm_ready() {
    local attempts="${1:-60}"
    local delay="${2:-2}"
    if ! wait_for_realm "$attempts" "$delay"; then
        return 1
    fi
    return 0
}

if [ "$realm_status" = "404" ] && [ -z "$REALM_FILE" ]; then
    log "Realm '${REALM_NAME}' not found. Creating minimal realm configuration."
    minimal_realm="$(mktemp -t keycloak-minimal-realm-XXXXXX.json)"
    TMP_FILES="$TMP_FILES $minimal_realm"
    cat >"$minimal_realm" <<EOF
{
  "realm": "${REALM_NAME}",
  "enabled": true,
  "displayName": "${REALM_NAME}"
}
EOF
    apply_realm "POST" "${BASE_URL}/admin/realms" "$minimal_realm" || exit 1
    log "Realm '${REALM_NAME}' created with default settings."
    if ! ensure_realm_ready 120 2; then
        log "Realm '${REALM_NAME}' was created but is not yet available."
        exit 1
    fi
    realm_status="200"
fi

if [ -n "$REALM_FILE" ]; then
    log "Applying realm configuration to '${REALM_NAME}' (status before import: ${realm_status:-unknown})."
    if [ "$realm_status" = "404" ]; then
        apply_realm "POST" "${BASE_URL}/admin/realms" "$REALM_FILE" || exit 1
    else
        apply_realm "PUT" "${BASE_URL}/admin/realms/${REALM_NAME}" "$REALM_FILE" || exit 1
    fi
    log "Realm configuration applied successfully."
    if ! ensure_realm_ready 120 2; then
        log "Realm '${REALM_NAME}' not reachable after applying configuration."
        exit 1
    fi
    realm_status="200"
fi

reset_imported_passwords() {
    local usernames_file="$1"
    if [ -z "${DEFAULT_USER_PASSWORD:-}" ]; then
        return 0
    fi
    if [ ! -f "$usernames_file" ] || [ ! -s "$usernames_file" ]; then
        return 0
    fi
    local password_payload
    password_payload="$(jq -nc --arg pass "$DEFAULT_USER_PASSWORD" '{type:"password", value:$pass, temporary:false}')" || return 1
    while IFS= read -r username || [ -n "$username" ]; do
        [ -n "${username:-}" ] || continue
        local encoded user_lookup user_id reset_status
        encoded="$(jq -rn --arg v "$username" '$v|@uri')"
        user_lookup="$(curl -sS -H "Authorization: Bearer ${ACCESS_TOKEN}" \
            -H 'Accept: application/json' \
            "${BASE_URL}/admin/realms/${REALM_NAME}/users?username=${encoded}" || true)"
        user_id="$(printf '%s' "$user_lookup" | jq -r '.[0].id // empty')"
        if [ -z "${user_id:-}" ] || [ "$user_id" = "null" ]; then
            log "Unable to locate user '${username}' for password reset."
            continue
        fi
        reset_status="$(curl -s -o /dev/null -w '%{http_code}' \
            -X PUT \
            -H "Authorization: Bearer ${ACCESS_TOKEN}" \
            -H 'Content-Type: application/json' \
            --data "$password_payload" \
            "${BASE_URL}/admin/realms/${REALM_NAME}/users/${user_id}/reset-password" || true)"
        if [ "$reset_status" = "204" ]; then
            log "Password reset applied for user '${username}'."
        else
            log "Failed to reset password for user '${username}' (HTTP ${reset_status})."
        fi
    done < "$usernames_file"
    return 0
}

import_users_file() {
    local source="$1"
    local payload tmp_response status usernames_file

    payload="$(mktemp -t keycloak-users-XXXXXX.json)"
    TMP_FILES="$TMP_FILES $payload"
    usernames_file="$(mktemp -t keycloak-usernames-XXXXXX.txt)"
    TMP_FILES="$TMP_FILES $usernames_file"
    if ! python3 - "$source" "$REALM_NAME" "$payload" "$usernames_file" <<'PY'
import json
import sys
from pathlib import Path

src, realm, dest, usernames_path = sys.argv[1:5]
data = json.loads(Path(src).read_text(encoding='utf-8'))

if isinstance(data, dict):
    users = data.get("users")
    groups = data.get("groups")
else:
    users = data
    groups = None

if users is None:
    sys.stderr.write("User import file must contain a 'users' array or be a list of users.\n")
    sys.exit(1)
if not isinstance(users, list):
    sys.stderr.write("'users' entry must be a list.\n")
    sys.exit(1)

def normalize_credentials(user_list):
    for user in user_list:
        credentials = user.get("credentials") or []
        for credential in credentials:
            if credential.get("hashIterations") is None:
                cred_data = credential.get("credentialData")
                parsed = None
                if isinstance(cred_data, str):
                    try:
                        parsed = json.loads(cred_data)
                    except json.JSONDecodeError:
                        parsed = None
                elif isinstance(cred_data, dict):
                    parsed = cred_data
                if isinstance(parsed, dict):
                    iterations = parsed.get("hashIterations")
                    if iterations is not None:
                        credential["hashIterations"] = iterations
                    algorithm = parsed.get("algorithm")
                    if algorithm and not credential.get("algorithm"):
                        credential["algorithm"] = algorithm
                    additional = parsed.get("additionalParameters")
                    if additional and not credential.get("additionalParameters"):
                        credential["additionalParameters"] = additional

normalize_credentials(users)
usernames = []
for user in users:
    name = user.get("username")
    if isinstance(name, str):
        name = name.strip()
        if name:
            usernames.append(name)

payload = {
    "realm": realm,
    "ifResourceExists": "OVERWRITE",
    "users": users
}
if isinstance(groups, list) and groups:
    payload["groups"] = groups

Path(dest).write_text(json.dumps(payload), encoding='utf-8')
Path(usernames_path).write_text("\n".join(sorted(set(usernames))), encoding='utf-8')
PY
    then
        log "Failed to prepare user import payload for ${source}."
        return 1
    fi

    tmp_response="$(mktemp -t keycloak-users-response-XXXXXX.json)"
    TMP_FILES="$TMP_FILES $tmp_response"

    status="$(curl -sS -o "${tmp_response}" -w '%{http_code}' \
        -X POST \
        -H 'Content-Type: application/json' \
        -H "Authorization: Bearer ${ACCESS_TOKEN}" \
        --data-binary "@${payload}" \
        "${BASE_URL}/admin/realms/${REALM_NAME}/partialImport" || true)"

    case "$status" in
        2*) ;;
        *)
            log "Partial import failed for ${source} (HTTP ${status}). Response:"
            sed 's/^/  /' "${tmp_response}" >&2
            return 1
            ;;
    esac

    log "Imported users from ${source}."
    jq '.' "${tmp_response}" >&2 || true
    if [ -n "${DEFAULT_USER_PASSWORD:-}" ]; then
        reset_imported_passwords "$usernames_file" || true
    fi
    return 0
}

if [ -n "$USER_FILES" ]; then
    if ! ensure_realm_ready 120 2; then
        log "Realm '${REALM_NAME}' is not available for user import."
        exit 1
    fi
    for user_file in $USER_FILES; do
        import_users_file "$user_file" || exit 1
    done
fi

if [ -n "$REALM_FILE" ]; then
    printf '%s\n' "$CLIENT_SECRET"
fi

ploinky var SSO_CLIENT_SECRET "$CLIENT_SECRET"
