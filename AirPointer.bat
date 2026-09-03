@echo off
setlocal
cd /d "%~dp0"

if exist "portable\AirPointer.exe" (
    start "" "portable\AirPointer.exe"
    exit /b 0
)

set "AIRPOINTER_PYTHON=.venv\Scripts\pythonw.exe"
if not exist "%AIRPOINTER_PYTHON%" set "AIRPOINTER_PYTHON=pythonw.exe"
start "" "%AIRPOINTER_PYTHON%" "%~dp0airpointer_launcher.py"
