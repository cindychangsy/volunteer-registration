@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ========================================================
echo   志工報名系統 - 一鍵綁定並推送到 GitHub 工具
echo ========================================================
echo.
set /p REPO_URL="請貼上您在 GitHub 建立的網址 (例如 https://github.com/帳號/volunteer-registration.git): "

if "%REPO_URL%"=="" (
  echo [錯誤] 您尚未輸入網址，請重新執行！
  pause
  exit /b 1
)

echo.
echo 正在設定 GitHub 遠端儲存庫位址...
git remote remove origin 2>nul
git remote add origin %REPO_URL%
git branch -M main

echo.
echo 正在將所有程式碼推送至 GitHub (若跳出 GitHub 登入視窗請點擊授權)...
git push -u origin main

echo.
echo ========================================================
echo   推送完成！現在可以前往 https://vercel.com/new 匯入此專案了！
echo ========================================================
pause
