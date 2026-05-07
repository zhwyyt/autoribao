@echo off
title QQ机器人 (NapCat OneBot)
echo 正在启动QQ机器人 (NapCat OneBot)...
cd /d "%~dp0"

REM 需要先启动 NapCatOneKey，并确保 OneBot HTTP(3000) / WS(3001) 已就绪
node src\qq-bot-napcat.js

pause

