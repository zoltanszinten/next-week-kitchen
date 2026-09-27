@echo off
cd /d "%~dp0"
where node >nul 2>&1
if %errorlevel%==0 (
  node server.js
) else (
  if exist "%~dp0..\project-hub\runtime\node.exe" (
    "%~dp0..\project-hub\runtime\node.exe" server.js
  ) else (
    echo Node.js was not found. Install Node.js 20 or newer, then run start.cmd again.
  )
)
echo.
pause
