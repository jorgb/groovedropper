#!/usr/bin/env bash
set -e
if [ -z "$1" ]; then
    echo "Error: database path required. Usage: ./run.sh /path/to/groovedropper.db" >&2
    exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
VENV="$SCRIPT_DIR/.venv"

if [ ! -d "$VENV" ]; then
    python3 -m venv "$VENV"
    "$VENV/bin/pip" install -r "$SCRIPT_DIR/requirements.txt"
fi

"$VENV/bin/python" "$SCRIPT_DIR/app.py" --db-file "$1"
