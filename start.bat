@echo off
cd /d "%~dp0"
title Gesture Photo Sphere - Launcher
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-server.ps1"
if errorlevel 1 (
  echo.
  echo [ERROR] The project could not start. See the message above.
  pause
  exit /b 1
)
exit /b 0
