#!/bin/sh
set -e

ploinky destroy
podman stop -a
podman rm -f -a
rm -rf .ploinky
rm -rf veritas-agent
rm -rf keycloak
