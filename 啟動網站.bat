@echo off
chcp 65001 >nul
cd /d "%~dp0"
if exist ".next" (
  echo 正在清除舊的 .next 快取...
  rmdir /s /q ".next"
)
echo 正在啟動志工報名系統開發伺服器 (http://localhost:3000)...
start http://localhost:3000
npm run dev
pause
