param([string]$DbFile)
if (-not $DbFile) {
    Write-Error "Database path required. Usage: .\run.ps1 `"C:\path\to\groovedropper.db`""
    exit 1
}

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Venv = Join-Path $ScriptDir '.venv'

if (-not (Test-Path $Venv)) {
    python -m venv $Venv
    & "$Venv\Scripts\pip" install -r "$ScriptDir\requirements.txt"
}

& "$Venv\Scripts\python" "$ScriptDir\app.py" --db-file $DbFile
