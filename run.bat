@echo off
setlocal
if "%~1"=="" (
    echo Error: database path required. Usage: run.bat "C:\path\to\groovedropper.db"
    exit /b 1
)

set SCRIPT_DIR=%~dp0
set VENV=%SCRIPT_DIR%.venv

if not exist "%VENV%" (
    python -m venv "%VENV%"
    "%VENV%\Scripts\pip" install -r "%SCRIPT_DIR%requirements.txt"
)

"%VENV%\Scripts\python" "%SCRIPT_DIR%app.py" --db-file "%~1"
