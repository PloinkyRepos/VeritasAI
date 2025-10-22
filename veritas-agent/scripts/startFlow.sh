#!/bin/sh

# ============================================================================
# startFlow.sh - Universal Ploinky Agent Launcher
# ============================================================================
# This script launches the orchestrator agent with environment variables
# loaded from the workspace's .ploinky/.secrets file.
#
# Usage (called by ploinky router):
#   /path/to/startFlow.sh [--sso-user=...] [--sso-roles=...] [other args]
#
# The script automatically detects the workspace directory from the
# current working directory and loads configuration from:
#   $WORKSPACE/.ploinky/.secrets
#
# Environment variables are loaded in this priority order:
#   1. Existing shell environment (highest priority)
#   2. This script's explicit exports
#   3. Workspace .ploinky/.secrets file (if exists)
#
# To set variables via ploinky CLI (from workspace):
#   ploinky var OPENAI_API_KEY "sk-your-key"
#   ploinky var LLMAgentClient_DEBUG "false"
# ============================================================================

# Get the absolute path to the script directory (VeritasAI root)
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Detect workspace directory (prefer explicit hint, then search upwards)
INITIAL_WORKSPACE_DIR="$(pwd)"

find_workspace_root() {
    local current="$1"
    while [ -n "$current" ] && [ "$current" != "/" ]; do
        if [ -d "$current/.ploinky" ]; then
            echo "$current"
            return 0
        fi
        local parent="$(dirname "$current")"
        if [ "$parent" = "$current" ]; then
            break
        fi
        current="$parent"
    done
    echo "$1"
}

WORKSPACE_DIR="$(find_workspace_root "$INITIAL_WORKSPACE_DIR")"

# Path to workspace secrets file
SECRETS_FILE="$WORKSPACE_DIR/.ploinky/.secrets"

# Path to orchestrator agent (in VeritasAI root, one level up from scripts/)
ORCHESTRATOR="$(dirname "$SCRIPT_DIR")/orchestratorAgent.mjs"

# Debug mode (set DEBUG=1 to see what's happening)
DEBUG="${DEBUG:-0}"

debug_log() {
    if [ "$DEBUG" = "1" ]; then
        echo "[startFlow.sh DEBUG] $*" >&2
    fi
}

# Suppress Node.js warnings (can be overridden by env)
export NODE_NO_WARNINGS="${NODE_NO_WARNINGS:-1}"

# Function to read a variable from the workspace .secrets file
# Usage: read_secret "VARIABLE_NAME"
read_secret() {
    local var_name="$1"
    if [ -f "$SECRETS_FILE" ]; then
        # Read the line matching VAR_NAME=value, extract value
        local value=$(grep "^${var_name}=" "$SECRETS_FILE" 2>/dev/null | head -n 1 | cut -d'=' -f2-)
        debug_log "read_secret($var_name): $value"
        echo "$value"
    else
        debug_log "read_secret($var_name): secrets file not found"
    fi
}

# Function to export variable from .secrets if not already set
# Usage: export_from_secrets "VARIABLE_NAME"
export_from_secrets() {
    local var_name="$1"
    local current_value
    eval "current_value=\${$var_name}"  # Get current value of the variable (POSIX compatible)
    
    # Only read from .secrets if variable is not already set
    if [ -z "$current_value" ]; then
        local secret_value=$(read_secret "$var_name")
        if [ -n "$secret_value" ]; then
            export "$var_name=$secret_value"
            debug_log "Exported $var_name from secrets"
        else
            debug_log "No value for $var_name in secrets"
        fi
    else
        debug_log "$var_name already set in environment"
    fi
}

# Verify orchestrator exists
if [ ! -f "$ORCHESTRATOR" ]; then
    echo "ERROR: orchestratorAgent.mjs not found at: $ORCHESTRATOR" >&2
    echo "Make sure you're running this from the correct location." >&2
    exit 1
fi

# ============================================================================
# LLM Provider API Keys
# ============================================================================
# These are required for the agent to communicate with LLM providers.
# Set via: ploinky var OPENAI_API_KEY "sk-your-key-here"

export_from_secrets "OPENAI_API_KEY"
export_from_secrets "ANTHROPIC_API_KEY"
export_from_secrets "GEMINI_API_KEY"
export_from_secrets "MISTRAL_API_KEY"
export_from_secrets "DEEPSEEK_API_KEY"
export_from_secrets "OPENROUTER_API_KEY"
export_from_secrets "HUGGINGFACE_API_KEY"

# ============================================================================
# Agent Feedback Control
# ============================================================================
# Control verbose output and debug logging from the Agent library.
# See: ploinky/Agent/AgentLib/FEEDBACK_CONTROL.md for details

export_from_secrets "LLMAgentClient_DEBUG"
export_from_secrets "LLMAgentClient_VERBOSE_DELAY"

# ============================================================================
# Custom Application Variables
# ============================================================================
# Add any custom environment variables your skills need below

# Example: Database connection
# export_from_secrets "DATABASE_URL"

# Example: External API keys
# export_from_secrets "STRIPE_API_KEY"
# export_from_secrets "SENDGRID_API_KEY"

# ============================================================================
# Explicit Overrides (Optional)
# ============================================================================
# Uncomment to override values from .secrets file
# These take precedence over values loaded from .secrets

# Example: Force debug mode on
# export LLMAgentClient_DEBUG="true"

# Example: Use a specific API key regardless of .secrets
# export OPENAI_API_KEY="sk-override-key-for-testing"

# ============================================================================
# Debug Output (Optional)
# ============================================================================
# Set DEBUG=1 environment variable to see configuration
# Example: DEBUG=1 ./startFlow.sh

if [ "$DEBUG" = "1" ]; then
    echo "[startFlow.sh] Configuration:" >&2
    echo "  Workspace: $WORKSPACE_DIR" >&2
    echo "  Secrets file: $SECRETS_FILE" >&2
    if [ -n "$OPENAI_API_KEY" ]; then
        echo "  OPENAI_API_KEY: [set]" >&2
    else
        echo "  OPENAI_API_KEY: [not set]" >&2
    fi
    echo "  LLMAgentClient_DEBUG: $LLMAgentClient_DEBUG" >&2
    echo "  LLMAgentClient_VERBOSE_DELAY: $LLMAgentClient_VERBOSE_DELAY" >&2
    echo "  Arguments: $@" >&2
fi

# ============================================================================
# Execute Orchestrator Agent
# ============================================================================
# Forward all CLI arguments (including --sso-* args from webchat)
# Uses exec to replace this shell process with node

debug_log "Executing: node --no-warnings $ORCHESTRATOR $@"
exec node --no-warnings "$ORCHESTRATOR" "$@"
