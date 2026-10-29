@echo off
cd /d "%~dp0"
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\build-release.ps1"
if errorlevel 1 (
  echo [ERROR] Packaging failed. See the message above.
  pause
  exit /b 1
)
pause
