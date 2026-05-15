#!/usr/bin/env bash
set -e
if [ -z "$1" ]; then
    echo "Error: database path required. Usage: ./bin/run.sh /path/to/groovedropper.db" >&2
    exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
VENV="$SCRIPT_DIR/.venv"

if [ ! -d "$VENV" ]; then
    if ! python3 -c "import ensurepip" 2>/dev/null; then
        PYTHON_VERSION=$(python3 -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')")
        echo "Error: Python venv support is not available. Install it with:" >&2
        echo "  sudo apt install python${PYTHON_VERSION}-venv" >&2
        exit 1
    fi
    python3 -m venv "$VENV"
fi
"$VENV/bin/pip" install -r "$SCRIPT_DIR/requirements.txt" --quiet

"$VENV/bin/python" "$SCRIPT_DIR/app.py" --db-file "$1"
