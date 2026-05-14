#!/usr/bin/env bash
# Build script: PyInstaller --onedir → AppImage
# Requires: python3, wget, libwebkit2gtk-4.0 (or 4.1) on the build machine
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
VENV="$SCRIPT_DIR/.venv"
APP_NAME="GrooveDropper"
ARCH="$(uname -m)"
APPIMAGE_OUT="${SCRIPT_DIR}/${APP_NAME}-${ARCH}.AppImage"
APPIMAGETOOL="${SCRIPT_DIR}/.appimagetool"

echo "=== GrooveDropper Linux AppImage Build ==="

# ── Python check ──────────────────────────────────────────────────────────────
if ! command -v python3 &>/dev/null; then
    echo "ERROR: python3 not found." >&2
    exit 1
fi

# ── venv ──────────────────────────────────────────────────────────────────────
if [ ! -d "$VENV" ]; then
    echo "[1/4] Creating virtual environment..."
    python3 -m venv "$VENV"
fi

echo "[1/4] Installing dependencies..."
"$VENV/bin/pip" install -r "$SCRIPT_DIR/requirements.txt" --quiet
"$VENV/bin/pip" install pyinstaller --quiet

# ── PyInstaller ───────────────────────────────────────────────────────────────
echo "[2/4] Running PyInstaller..."

# --onedir is required: AppImage wraps the directory; also avoids LD issues
"$VENV/bin/pyinstaller" \
    "$SCRIPT_DIR/app_gui.py" \
    --name "$APP_NAME" \
    --onedir \
    "--add-data=templates:templates" \
    "--add-data=static:static" \
    "--add-data=VERSION:." \
    --collect-all webview \
    --hidden-import groove.db \
    --hidden-import groove.wav \
    --hidden-import groove.queue \
    --noconfirm \
    --clean

# ── AppDir ────────────────────────────────────────────────────────────────────
echo "[3/4] Creating AppDir..."
rm -rf "$SCRIPT_DIR/AppDir"
mkdir -p "$SCRIPT_DIR/AppDir/usr/bin"

cp -r "$SCRIPT_DIR/dist/$APP_NAME/." "$SCRIPT_DIR/AppDir/usr/bin/"

# AppRun
cat > "$SCRIPT_DIR/AppDir/AppRun" << 'APPRUN'
#!/bin/bash
HERE="$(dirname "$(readlink -f "${0}")")"
export LD_LIBRARY_PATH="$HERE/usr/bin:${LD_LIBRARY_PATH:-}"
exec "$HERE/usr/bin/GrooveDropper" "$@"
APPRUN
chmod +x "$SCRIPT_DIR/AppDir/AppRun"

# .desktop file
cat > "$SCRIPT_DIR/AppDir/groovedropper.desktop" << 'DESKTOP'
[Desktop Entry]
Name=GrooveDropper
Comment=Random needle drop sample picker
Exec=GrooveDropper
Icon=groovedropper
Type=Application
Categories=Audio;Music;
Terminal=false
DESKTOP

# Icon
cp "$SCRIPT_DIR/media/icon-256.png" "$SCRIPT_DIR/AppDir/groovedropper.png"

# ── appimagetool ──────────────────────────────────────────────────────────────
echo "[4/4] Building AppImage..."
if [ ! -f "$APPIMAGETOOL" ]; then
    echo "Downloading appimagetool for ${ARCH}..."
    wget -q --show-progress -O "$APPIMAGETOOL" \
        "https://github.com/AppImage/AppImageKit/releases/latest/download/appimagetool-${ARCH}.AppImage"
fi
chmod +x "$APPIMAGETOOL"

ARCH="$ARCH" APPIMAGE_EXTRACT_AND_RUN=1 "$APPIMAGETOOL" "$SCRIPT_DIR/AppDir" "$APPIMAGE_OUT"

echo ""
echo "=== Build complete ==="
echo "Output : $APPIMAGE_OUT"
echo "Run    : chmod +x $APPIMAGE_OUT && $APPIMAGE_OUT"
echo "  Database defaults to ~/groovedropper.db"
echo "  Override: $APPIMAGE_OUT --db-file /path/to/your.db"
echo ""
echo "NOTE: The host system must have libwebkit2gtk-4.0 or libwebkit2gtk-4.1 installed."
echo "  Ubuntu/Debian: sudo apt install libwebkit2gtk-4.1-0"
echo "  Fedora:        sudo dnf install webkit2gtk4.1"
