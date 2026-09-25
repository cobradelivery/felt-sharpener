#!/usr/bin/env sh
# Start Felt Sharpener with the local AI-coach harness (macOS / Linux).
cd "$(dirname "$0")" || exit 1
if command -v python3 >/dev/null 2>&1; then exec python3 server/harness.py "$@"; fi
if command -v python >/dev/null 2>&1; then exec python server/harness.py "$@"; fi
echo "Python 3 not found. You can still play by opening index.html in your browser."
