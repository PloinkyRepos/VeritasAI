#!/bin/sh
set -eu

REPO_URL="https://github.com/run-llama/LlamaIndexTS.git"
PROJECT_ROOT="${PROJECT_ROOT:-$(pwd)}"
TARGET_ROOT="${PROJECT_ROOT}/vendor"
TARGET_DIR="${TARGET_ROOT}/llamaindex"
BRANCH="main"

# Asigură-te că avem unelte de git în container.
if ! command -v git >/dev/null 2>&1; then
    echo "Instalez git (lipsea din imagine)." >&2
    apk add --no-cache git >/dev/null
fi

mkdir -p "${TARGET_ROOT}"

if [ -d "${TARGET_DIR}/.git" ]; then
    echo "Actualizez ${TARGET_DIR} din repo-ul upstream."
    git -C "${TARGET_DIR}" fetch --depth=1 origin "${BRANCH}"
    git -C "${TARGET_DIR}" checkout "${BRANCH}"
    git -C "${TARGET_DIR}" reset --hard "origin/${BRANCH}"
else
    echo "Clonare ${REPO_URL} în ${TARGET_DIR}."
    rm -rf "${TARGET_DIR}"
    git clone --depth=1 --branch "${BRANCH}" "${REPO_URL}" "${TARGET_DIR}"
fi

# Instalează dependențele local, sub vendor/, ca să nu atingem /node_modules read-only.
echo "Rulez npm install în ${TARGET_DIR}."
( cd "${TARGET_DIR}" && npm install --omit=dev >/dev/null )

echo "Repo ${REPO_URL} pregătit în ${TARGET_DIR}."
echo "Setează NODE_PATH=./vendor/llamaindex/node_modules:./vendor pentru runtime." >&2
