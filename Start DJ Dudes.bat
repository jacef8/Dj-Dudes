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

if not exist "node_modules\electron\dist\electron.exe" goto install
if not exist "node_modules\qrcode-generator" goto install
goto run

:install
echo.
echo  First-time setup: downloading what DJ Dudes needs (needs internet, takes a minute or two)...
echo.
call npm install
if errorlevel 1 (
  echo.
  echo  Setup failed. Check your internet connection and try again.
  pause
  exit /b
)

:run
rem Once Electron is fully downloaded, start the app on its own so this window can close.
if exist "node_modules\electron\dist\electron.exe" (
  start "" "node_modules\electron\dist\electron.exe" .
  exit /b
)
echo.
echo  Finishing setup. Leave this window open while you use DJ Dudes this time.
echo  From now on it will close by itself.
echo.
call npm start
