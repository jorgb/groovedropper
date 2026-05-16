@echo off
setlocal

echo Starting GrooveDropper ...

python --version >nul 2>&1
if errorlevel 1 (
    echo Python is not installed or not on your PATH.
    echo.
    echo Install it from https://www.python.org/downloads/
    echo Make sure to check "Add Python to PATH" during installation.
    pause
    exit /b 1
)

set VENV=%~dp0.venv

if not exist "%VENV%" (
    echo Setting up .venv (first run can take a while)
    python -m venv "%VENV%"
)

"%VENV%\Scripts\pip" install -r "%~dp0requirements.txt" --quiet

"%VENV%\Scripts\python" "%~dp0app.py" %*
