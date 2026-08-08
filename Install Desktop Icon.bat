@echo off
REM Double-click this to put an Architecture Design icon on your desktop.
REM It installs what is needed, builds the application, and creates the icon.
setlocal
cd /d "%~dp0"

where node >/dev/null 2>nul
if errorlevel 1 (
  echo.
  echo   Node.js is not installed, or is not on the PATH.
  echo.
  echo   Install it from https://nodejs.org ^(the LTS version^), then
  echo   double-click this file again.
  echo.
  pause
  exit /b 1
)

node "tools\setup-desktop.mjs"
set EXITCODE=%errorlevel%

echo.
echo   Press any key to close this window.
pause >nul
exit /b %EXITCODE%
