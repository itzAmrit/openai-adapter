#!/usr/bin/env bash
set -euo pipefail

PLIST_LABEL="com.local.openai-adapter"
PLIST_FILE="${HOME}/Library/LaunchAgents/${PLIST_LABEL}.plist"

echo "Stopping and uninstalling ${PLIST_LABEL}..."

launchctl bootout "gui/$(id -u)/${PLIST_LABEL}" 2>/dev/null || true
rm -f "${PLIST_FILE}"

echo "Service ${PLIST_LABEL} uninstalled."
