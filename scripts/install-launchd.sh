#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
PLIST_LABEL="com.local.openai-adapter"
PLIST_FILE="${HOME}/Library/LaunchAgents/${PLIST_LABEL}.plist"
NODE_BIN="$(which node)"

echo "Installing ${PLIST_LABEL} launchd service..."

mkdir -p "${HOME}/Library/LaunchAgents"

cat << PLIST > "${PLIST_FILE}"
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${PLIST_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${NODE_BIN}</string>
    <string>${ROOT_DIR}/src/index.js</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${ROOT_DIR}</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${ROOT_DIR}/adapter.log</string>
  <key>StandardErrorPath</key>
  <string>${ROOT_DIR}/adapter.err.log</string>
</dict>
</plist>
PLIST

launchctl bootout "gui/$(id -u)/${PLIST_LABEL}" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "${PLIST_FILE}"
launchctl kickstart -k "gui/$(id -u)/${PLIST_LABEL}"

echo "Service ${PLIST_LABEL} successfully installed and started."
echo "Logs: ${ROOT_DIR}/adapter.log and ${ROOT_DIR}/adapter.err.log"
