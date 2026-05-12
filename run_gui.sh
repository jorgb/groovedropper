#!/usr/bin/env bash
set -e
if [ -z "$1" ]; then
    echo "Error: database path required. Usage: ./run_gui.sh /path/to/groovedropper.db" >&2
    exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
VENV="$SCRIPT_DIR/.venv"

# On Linux, pywebview uses GTK via the system 'gi' package which can't be pip-installed.
VENV_EXTRA_ARGS=""
if [ "$(uname)" = "Linux" ]; then
    if ! python3 -c "import gi" 2>/dev/null; then
        PYTHON_VERSION=$(python3 -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')")
        echo "Error: GTK Python bindings are required on Linux. Install them with:" >&2
        echo "  sudo apt install python3-gi python3-gi-cairo gir1.2-gtk-3.0 gir1.2-webkit2-4.1" >&2
        exit 1
    fi
    VENV_EXTRA_ARGS="--system-site-packages"
    # If an existing venv lacks system-site-packages, recreate it.
    if [ -d "$VENV" ] && ! grep -q "include-system-site-packages = true" "$VENV/pyvenv.cfg" 2>/dev/null; then
        echo "Recreating venv with --system-site-packages for GTK support..."
        rm -rf "$VENV"
    fi
fi

if [ ! -d "$VENV" ]; then
    if ! python3 -c "import ensurepip" 2>/dev/null; then
        PYTHON_VERSION=$(python3 -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')")
        echo "Error: Python venv support is not available. Install it with:" >&2
        echo "  sudo apt install python${PYTHON_VERSION}-venv" >&2
        exit 1
    fi
    # shellcheck disable=SC2086
    python3 -m venv $VENV_EXTRA_ARGS "$VENV"
    "$VENV/bin/pip" install -r "$SCRIPT_DIR/requirements.txt"
fi

"$VENV/bin/python" "$SCRIPT_DIR/app_gui.py" --db-file "$1"
