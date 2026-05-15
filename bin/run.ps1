if ($args.Count -eq 0) {
    Write-Error "Usage: .\bin\run.ps1 --db-file `"C:\path\to\groovedropper.db`" [--port PORT] [--serve]"
    exit 1
}

if (-not (Get-Command python -ErrorAction SilentlyContinue)) {
    Write-Host "Python is not installed or not on your PATH."
    Write-Host ""
    Write-Host "Install it from https://www.python.org/downloads/"
    Write-Host "Make sure to check 'Add Python to PATH' during installation."
    exit 1
}

$BinDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ScriptDir = Split-Path -Parent $BinDir
$Venv = Join-Path $ScriptDir '.venv'

if (-not (Test-Path $Venv)) {
    python -m venv $Venv
}

Write-Host "Setting up .venv (first run can take a while)"
& "$Venv\Scripts\pip" install -r "$ScriptDir\requirements.txt" --quiet

& "$Venv\Scripts\python" "$ScriptDir\app.py" @args
