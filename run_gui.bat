@echo off
setlocal
if "%~1"=="" (
    echo Error: database path required. Usage: run_gui.bat "C:\path\to\groovedropper.db"
    exit /b 1
)

python --version >nul 2>&1
if errorlevel 1 (
    echo Python is not installed or not on your PATH.
    echo.
    echo Install it from https://www.python.org/downloads/
    echo Make sure to check "Add Python to PATH" during installation.
    exit /b 1
)

set SCRIPT_DIR=%~dp0
set VENV=%SCRIPT_DIR%.venv

if not exist "%VENV%" (
    python -m venv "%VENV%"
    "%VENV%\Scripts\pip" install -r "%SCRIPT_DIR%requirements.txt"
)

"%VENV%\Scripts\python" "%SCRIPT_DIR%app_gui.py" --db-file "%~1"
