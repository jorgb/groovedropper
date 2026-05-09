param(
    [switch]$SkipPython,
    [switch]$SkipInstall
)

$ErrorActionPreference = 'Stop'

Write-Host "=== GrooveDropper Windows Build ===" -ForegroundColor Cyan

# electron-builder extracts winCodeSign which contains symlinks (macOS dylibs).
# Windows requires Developer Mode or admin rights to create symlinks.
$devMode = (Get-ItemProperty `
    'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\AppModelUnlock' `
    -Name AllowDevelopmentWithoutDevLicense -ErrorAction SilentlyContinue
).AllowDevelopmentWithoutDevLicense
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

if (-not $devMode -and -not $isAdmin) {
    Write-Host ""
    Write-Host "ERROR: Windows Developer Mode is required to build." -ForegroundColor Red
    Write-Host "  Enable it: Settings > System > For Developers > Developer Mode" -ForegroundColor Red
    Write-Host "  (or re-run this script as Administrator)" -ForegroundColor Red
    exit 1
}

# --- Python backend ---------------------------------------------------------
if (-not $SkipPython) {
    Write-Host "`n[1/3] Building Python backend with PyInstaller..." -ForegroundColor Yellow
    python -m pip install pyinstaller --quiet
    if ($LASTEXITCODE -ne 0) { Write-Host "pip install pyinstaller failed" -ForegroundColor Red; exit 1 }

    pyinstaller app.spec --distpath dist-backend --noconfirm
    if ($LASTEXITCODE -ne 0) { Write-Host "PyInstaller failed" -ForegroundColor Red; exit 1 }
    Write-Host "Backend built: dist-backend\groove_backend.exe" -ForegroundColor Green
} else {
    Write-Host "`n[1/3] Skipping Python backend (--SkipPython)" -ForegroundColor DarkGray
    if (-not (Test-Path "dist-backend\groove_backend.exe")) {
        Write-Host "WARNING: dist-backend\groove_backend.exe not found - installer will be incomplete" -ForegroundColor Yellow
    }
}

# --- Node dependencies ------------------------------------------------------
if (-not $SkipInstall) {
    Write-Host "`n[2/3] Installing Node dependencies..." -ForegroundColor Yellow
    npm install
    if ($LASTEXITCODE -ne 0) { Write-Host "npm install failed" -ForegroundColor Red; exit 1 }
} else {
    Write-Host "`n[2/3] Skipping npm install (--SkipInstall)" -ForegroundColor DarkGray
}

# --- Electron installer -----------------------------------------------------
Write-Host "`n[3/3] Building Windows installer with electron-builder..." -ForegroundColor Yellow
$env:CSC_IDENTITY_AUTO_DISCOVERY = 'false'
npx electron-builder --win --publish never
if ($LASTEXITCODE -ne 0) { Write-Host "electron-builder failed" -ForegroundColor Red; exit 1 }

Write-Host "`n=== Build complete ===" -ForegroundColor Green
Get-ChildItem dist\*.exe -ErrorAction SilentlyContinue |
    Select-Object Name, @{L='Size';E={"{0:N1} MB" -f ($_.Length / 1MB)}} |
    Format-Table -AutoSize
