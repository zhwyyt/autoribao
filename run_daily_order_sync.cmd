@echo off
setlocal

rem 每日增量订单同步：仅处理 sales_order 中不存在的新订单，再桥接涉及项目
rem 建议排在 run_production_plan_components_changed.cmd 之后（先产库构件，再订单关联）
rem 全量重跑请手动：node src\extract-order-sync.js（不加 --incremental）
rem Windows 任务计划：以管理员运行 create_daily_order_sync_task.ps1 注册（任务名 DongwuDailyOrderSync）
set "PROJECT_DIR=%~sdp0"
if "%PROJECT_DIR:~-1%"=="\" set "PROJECT_DIR=%PROJECT_DIR:~0,-1%"

set "NODE_EXE=C:\Program Files\nodejs\node.exe"

if not exist "%PROJECT_DIR%\logs" mkdir "%PROJECT_DIR%\logs" >nul 2>&1
chcp 65001 >nul

for /f %%i in ('powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-Date -Format yyyy-MM-dd"') do set "TODAY=%%i"
set "LOG_FILE=%PROJECT_DIR%\logs\daily_order_sync_%TODAY%.log"

if not exist "%LOG_FILE%" (
  powershell -NoProfile -ExecutionPolicy Bypass -Command "[System.IO.File]::WriteAllText('%LOG_FILE%',[string][char]0xFEFF,[System.Text.Encoding]::UTF8)" >nul 2>&1
)

echo ===== [%date% %time%] START =====>> "%LOG_FILE%"

if not exist "%NODE_EXE%" (
  echo node.exe not found: "%NODE_EXE%" >> "%LOG_FILE%"
  exit /b 2
)

set ERR=0

pushd "%PROJECT_DIR%"

echo --- [%date% %time%] extract-order-sync --->> "%LOG_FILE%"
"%NODE_EXE%" "%PROJECT_DIR%\src\extract-order-sync.js" --incremental --page-size 50 --sleep-ms 200 >> "%LOG_FILE%" 2>&1
if errorlevel 1 (
  set ERR=1
  echo extract-order-sync FAILED >> "%LOG_FILE%"
  goto :done
)

echo --- [%date% %time%] extract-project-order-bridge --->> "%LOG_FILE%"
"%NODE_EXE%" "%PROJECT_DIR%\src\extract-project-order-bridge.js" --incremental --sleep-ms 200 >> "%LOG_FILE%" 2>&1
if errorlevel 1 (
  set ERR=2
  echo extract-project-order-bridge FAILED >> "%LOG_FILE%"
)

:done
popd

echo ===== [%date% %time%] END (code=%ERR%) =====>> "%LOG_FILE%"
exit /b %ERR%
