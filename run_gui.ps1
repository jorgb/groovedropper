param([string]$DbFile)
if (-not $DbFile) {
    Write-Error "Database path required. Usage: .\run_gui.ps1 `"C:\path\to\groovedropper.db`""
    exit 1
}

if (-not (Get-Command python -ErrorAction SilentlyContinue)) {
    Write-Host "Python is not installed or not on your PATH."
    Write-Host ""
    Write-Host "Install it from https://www.python.org/downloads/"
    Write-Host "Make sure to check 'Add Python to PATH' during installation."
    exit 1
}

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Venv = Join-Path $ScriptDir '.venv'

if (-not (Test-Path $Venv)) {
    python -m venv $Venv
    & "$Venv\Scripts\pip" install -r "$ScriptDir\requirements.txt"
}

& "$Venv\Scripts\python" "$ScriptDir\app_gui.py" --db-file $DbFile
