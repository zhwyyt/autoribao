@echo off
setlocal

rem Use script directory, prefer 8.3 short path to avoid issues with non-ASCII paths in cmd/task scheduler.
set "PROJECT_DIR=%~sdp0"
if "%PROJECT_DIR:~-1%"=="\" set "PROJECT_DIR=%PROJECT_DIR:~0,-1%"
set "NODE_EXE=C:\Program Files\nodejs\node.exe"
set "LOG_FILE=%PROJECT_DIR%\logs\daily_report.log"

if not exist "%PROJECT_DIR%\logs" mkdir "%PROJECT_DIR%\logs" >nul 2>&1

rem Force UTF-8 codepage for consistent log encoding.
chcp 65001 >nul

rem If log file does not exist, create it with UTF-8 BOM so Notepad can display Chinese correctly.
if not exist "%LOG_FILE%" (
  powershell -NoProfile -ExecutionPolicy Bypass -Command "[System.IO.File]::WriteAllText('%LOG_FILE%',[string][char]0xFEFF,[System.Text.Encoding]::UTF8)" >nul 2>&1
)

echo ===== [%date% %time%] START =====>> "%LOG_FILE%"

if not exist "%NODE_EXE%" (
  echo node.exe not found: "%NODE_EXE%" >> "%LOG_FILE%"
  exit /b 2
)

pushd "%PROJECT_DIR%"
"%NODE_EXE%" "%PROJECT_DIR%\src\main.js" --daily >> "%LOG_FILE%" 2>&1
set ERR=%ERRORLEVEL%
popd

echo ===== [%date% %time%] END (code=%ERR%) =====>> "%LOG_FILE%"

exit /b %ERR%
