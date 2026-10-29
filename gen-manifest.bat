@echo off
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0gen-manifest.ps1"
set "manifest_exit=%errorlevel%"
if not "%manifest_exit%"=="0" echo [ERROR] Could not update the image list.
if /I not "%~1"=="--no-pause" pause
exit /b %manifest_exit%
