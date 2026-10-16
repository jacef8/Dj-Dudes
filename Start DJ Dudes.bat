@echo off
title DJ Dudes
cd /d "%~dp0"

where npm >nul 2>nul
if errorlevel 1 (
  echo.
  echo  Node.js is not installed yet.
  echo  Your browser will open the Node.js website. Download the "LTS" version,
  echo  install it with the default options, then double-click this file again.
  echo.
  start https://nodejs.org
  pause
  exit /b
)

if not exist "node_modules\qrcode-generator" goto install
if not exist "node_modules\electron\dist\electron.exe" goto install
goto run

:install
echo.
echo  First-time setup: downloading what DJ Dudes needs (needs internet, takes a minute or two)...
echo.
call npm install
if errorlevel 1 goto failed
if not exist "node_modules\electron\dist\electron.exe" call node node_modules\electron\install.js
if not exist "node_modules\electron\dist\electron.exe" goto failed

:run
rem Open DJ Dudes on its own so this window can close. Without this setting the app
rem hooks itself to this window to print messages, which keeps the window open.
set ELECTRON_NO_ATTACH_CONSOLE=1
start "" "node_modules\electron\dist\electron.exe" "%~dp0."
rem then put a DJ Dudes icon on the Desktop and in the Start menu (refreshed every time).
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0make-shortcut.ps1" >nul 2>nul
exit /b

:failed
echo.
echo  Setup failed. Check your internet connection and try again.
pause
exit /b
