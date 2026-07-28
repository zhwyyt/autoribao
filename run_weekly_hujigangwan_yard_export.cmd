@echo off
setlocal

set "PROJECT_DIR=%~sdp0"
if "%PROJECT_DIR:~-1%"=="\" set "PROJECT_DIR=%PROJECT_DIR:~0,-1%"
set "NODE_EXE=C:\Program Files\nodejs\node.exe"

if not exist "%PROJECT_DIR%\logs" mkdir "%PROJECT_DIR%\logs" >nul 2>&1
for /f %%i in ('powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-Date -Format yyyy-MM-dd"') do set "TODAY=%%i"
set "LOG_FILE=%PROJECT_DIR%\logs\weekly_hujigangwan_yard_export_%TODAY%.log"

echo ===== [%date% %time%] START =====>> "%LOG_FILE%"
pushd "%PROJECT_DIR%"
"%NODE_EXE%" "%PROJECT_DIR%\src\weekly-hujigangwan-yard-export.js" >> "%LOG_FILE%" 2>&1
set "ERR=0"
if errorlevel 1 set "ERR=1"
"%NODE_EXE%" "%PROJECT_DIR%\src\export-logistics-vehicle-workbook.js" >> "%LOG_FILE%" 2>&1
if errorlevel 1 set "ERR=1"
"%NODE_EXE%" "%PROJECT_DIR%\src\download-weekly-hujigangwan-plan-codes.js" >> "%LOG_FILE%" 2>&1
if errorlevel 1 set "ERR=1"
popd
echo ===== [%date% %time%] END (code=%ERR%) =====>> "%LOG_FILE%"
exit /b %ERR%
