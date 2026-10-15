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
call npm start
