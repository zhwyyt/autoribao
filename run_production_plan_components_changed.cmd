@echo off
setlocal

rem 拉取活跃项目生产计划，并仅同步本批次有变更的计划的构件（--api --by-project --components-changed-only）
rem Use script directory, prefer 8.3 short path to avoid issues with non-ASCII paths in cmd/task scheduler.
set "PROJECT_DIR=%~sdp0"
if "%PROJECT_DIR:~-1%"=="\" set "PROJECT_DIR=%PROJECT_DIR:~0,-1%"

set "NODE_EXE=C:\Program Files\nodejs\node.exe"
set "LOG_FILE=%PROJECT_DIR%\logs\production_plan_components_sync.log"

if not exist "%PROJECT_DIR%\logs" mkdir "%PROJECT_DIR%\logs" >nul 2>&1

chcp 65001 >nul

if not exist "%LOG_FILE%" (
  powershell -NoProfile -ExecutionPolicy Bypass -Command "[System.IO.File]::WriteAllText('%LOG_FILE%',[string][char]0xFEFF,[System.Text.Encoding]::UTF8)" >nul 2>&1
)

echo ===== [%date% %time%] START =====>> "%LOG_FILE%"

if not exist "%NODE_EXE%" (
  echo node.exe not found: "%NODE_EXE%" >> "%LOG_FILE%"
  exit /b 2
)

pushd "%PROJECT_DIR%"
"%NODE_EXE%" "%PROJECT_DIR%\src\extract-production-plan.js" --api --by-project --components-changed-only >> "%LOG_FILE%" 2>&1
set ERR=%ERRORLEVEL%
popd

echo ===== [%date% %time%] END (code=%ERR%) =====>> "%LOG_FILE%"

exit /b %ERR%
