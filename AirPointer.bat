@echo off
setlocal
cd /d "%~dp0"

set "AIRPOINTER_PYTHON=.venv\Scripts\pythonw.exe"
if not exist "%AIRPOINTER_PYTHON%" (
    echo AirPointer is not installed yet.
    echo Run the setup commands in README.md first.
    pause
    exit /b 1
)

start "" "%AIRPOINTER_PYTHON%" -m airpointer.main
