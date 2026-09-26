@echo off
rem Arkham Grimoire: serve the page locally and open it in the browser.
rem Double-click this file. Close the window (or Ctrl+C) to stop the server.
cd /d "%~dp0"
title Arkham Grimoire

where node >nul 2>nul
if %errorlevel%==0 (
  node scripts\serve.js %*
  goto :end
)

rem No Node.js: fall back to Python's built-in server.
set PORT=8777
where py >nul 2>nul
if %errorlevel%==0 (
  start "" "http://127.0.0.1:%PORT%/"
  py -m http.server %PORT% --bind 127.0.0.1
  goto :end
)
where python >nul 2>nul
if %errorlevel%==0 (
  start "" "http://127.0.0.1:%PORT%/"
  python -m http.server %PORT% --bind 127.0.0.1
  goto :end
)

echo Neither Node.js nor Python was found.
echo Install Node.js from https://nodejs.org/ and run this file again.

:end
pause
