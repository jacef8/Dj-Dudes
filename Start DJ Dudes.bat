@echo off
title DJ Dudes
cd /d "%~dp0"

rem DJ Dudes should not run from inside Google Drive or OneDrive: setup creates
rem thousands of files the sync app would try to upload. If this copy is in a
rem synced folder, copy the app to a normal folder on this PC and run it there.
set "HERE=%~dp0"
echo "%HERE%" | findstr /i /c:"My Drive" /c:"Google Drive" /c:"Shared drives" /c:"OneDrive" >nul
if not errorlevel 1 goto relocate

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

:relocate
set "DEST=%USERPROFILE%\Projects\DJ-Dudes"
echo.
echo  This copy of DJ Dudes is inside Google Drive or OneDrive, so it will run
echo  from a normal folder on this PC instead:
echo    %DEST%
echo  Copying the app there now. Your songs and playlists are not affected.
echo.
robocopy "%HERE%." "%DEST%" /E /XD node_modules .git /NFL /NDL /NJH /NJS /NP >nul
if errorlevel 8 goto copyfailed
echo  Done. From now on, open DJ Dudes with the icon on your Desktop.
echo  This Google Drive copy is just a backup now.
if exist "%HERE%node_modules" echo  You can delete the "node_modules" folder in the Google Drive copy to save space.
echo.
call "%DEST%\Start DJ Dudes.bat"
exit /b

:copyfailed
echo  Copying failed. Copy this folder to %DEST% yourself,
echo  then double-click Start DJ Dudes.bat in that folder.
pause
exit /b
