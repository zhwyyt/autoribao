@echo off
setlocal

set "PROJECT_DIR=%~sdp0"
if "%PROJECT_DIR:~-1%"=="\" set "PROJECT_DIR=%PROJECT_DIR:~0,-1%"
set "NODE_EXE=C:\Program Files\nodejs\node.exe"

if not exist "%PROJECT_DIR%\logs" mkdir "%PROJECT_DIR%\logs" >nul 2>&1
chcp 65001 >nul

for /f %%i in ('powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-Date -Format yyyy-MM-dd"') do set "TODAY=%%i"
set "LOG_FILE=%PROJECT_DIR%\logs\nightly_shipping_alignment_%TODAY%.log"

if not exist "%LOG_FILE%" (
  powershell -NoProfile -ExecutionPolicy Bypass -Command "[System.IO.File]::WriteAllText('%LOG_FILE%',[string][char]0xFEFF,[System.Text.Encoding]::UTF8)" >nul 2>&1
)

echo ===== [%date% %time%] START =====>> "%LOG_FILE%"

if not exist "%NODE_EXE%" (
  echo node.exe not found: "%NODE_EXE%" >> "%LOG_FILE%"
  exit /b 2
)

pushd "%PROJECT_DIR%"
"%NODE_EXE%" "%PROJECT_DIR%\src\nightly-reconciliation-runner.js" --task shipping --range daily >> "%LOG_FILE%" 2>&1
set ERR=%ERRORLEVEL%
popd

echo ===== [%date% %time%] END (code=%ERR%) =====>> "%LOG_FILE%"
exit /b %ERR%
