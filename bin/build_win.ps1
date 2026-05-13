param(
    [switch]$SkipInstall
)

$ErrorActionPreference = 'Stop'

$BinDir    = Split-Path -Parent $MyInvocation.MyCommand.Path
$ScriptDir = Split-Path -Parent $BinDir
$Venv      = Join-Path $ScriptDir '.venv'
$AppName   = 'GrooveDropper'
$OutDir    = Join-Path $ScriptDir 'dist'
$ZipOut    = Join-Path $ScriptDir "$AppName-win.zip"

Write-Host "=== GrooveDropper Windows Build ===" -ForegroundColor Cyan

if (-not (Get-Command python -ErrorAction SilentlyContinue)) {
    Write-Host "ERROR: Python not found. Install from https://www.python.org/downloads/" -ForegroundColor Red
    exit 1
}

# ── venv ──────────────────────────────────────────────────────────────────────
if (-not (Test-Path $Venv)) {
    Write-Host "`n[1/3] Creating virtual environment..." -ForegroundColor Yellow
    python -m venv $Venv
}

if (-not $SkipInstall) {
    Write-Host "`n[1/3] Installing dependencies..." -ForegroundColor Yellow
    & "$Venv\Scripts\pip" install -r "$ScriptDir\requirements.txt" --quiet
    & "$Venv\Scripts\pip" install pyinstaller --quiet
} else {
    Write-Host "`n[1/3] Skipping install (--SkipInstall)" -ForegroundColor DarkGray
}

# ── PyInstaller ───────────────────────────────────────────────────────────────
Write-Host "`n[2/3] Running PyInstaller..." -ForegroundColor Yellow

#   --onedir  : more reliable than --onefile with pywebview/pythonnet on Windows
#   --windowed: no console window (errors go to %TEMP%\GrooveDropper\*.log)
& "$Venv\Scripts\pyinstaller" `
    "$ScriptDir\app_gui.py" `
    --name $AppName `
    --onedir `
    --windowed `
    "--add-data=templates;templates" `
    "--add-data=static;static" `
    "--add-data=VERSION;." `
    --collect-all webview `
    --collect-all engineio `
    --hidden-import groove.db `
    --hidden-import groove.wav `
    --hidden-import groove.queue `
    --noconfirm `
    --clean

if ($LASTEXITCODE -ne 0) {
    Write-Host "PyInstaller failed." -ForegroundColor Red
    exit 1
}

# ── Zip ───────────────────────────────────────────────────────────────────────
Write-Host "`n[3/3] Compressing to $ZipOut..." -ForegroundColor Yellow
$BundleDir = Join-Path $OutDir $AppName
if (Test-Path $ZipOut) { Remove-Item $ZipOut -Force }
Compress-Archive -Path "$BundleDir\*" -DestinationPath $ZipOut

Write-Host "`n=== Build complete ===" -ForegroundColor Green
Write-Host "Archive : $ZipOut" -ForegroundColor Cyan
Write-Host "Unzip and run $AppName.exe" -ForegroundColor Cyan
Write-Host "  Database defaults to %USERPROFILE%\groovedropper.db" -ForegroundColor Cyan
Write-Host "  Override: $AppName.exe --db-file C:\path\to\your.db" -ForegroundColor Cyan
