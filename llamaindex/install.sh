#!/bin/sh
set -eu

PROJECT_ROOT="${PROJECT_ROOT:-$(pwd)}"
TARGET_ROOT="${PROJECT_ROOT}/vendor"
PACKAGE_NAME="llamaindex"

echo "Installing ${PACKAGE_NAME} into ${TARGET_ROOT} using npm prefix."
mkdir -p "${TARGET_ROOT}"

# npm respects the prefix and writes under vendor/node_modules.
npm install --omit=dev --prefix "${TARGET_ROOT}" "${PACKAGE_NAME}"@latest

echo "Package ${PACKAGE_NAME} installed under ${TARGET_ROOT}."
echo "Ensure NODE_PATH includes ./vendor/node_modules for runtime resolution." >&2
