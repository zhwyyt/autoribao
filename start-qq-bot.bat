@echo off
title QQ机器人
echo 正在启动QQ机器人...
cd /d "%~dp0"
node src/qq-bot.js
pause
