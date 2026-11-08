@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ========================================================
echo   志工報名系統 - 一鍵推送至 GitHub (cindychangsy/volunteer-registration)
echo ========================================================
echo.
echo 正在設定 GitHub 遠端儲存庫位址：
echo https://github.com/cindychangsy/volunteer-registration.git
git remote remove origin 2>nul
git remote add origin https://github.com/cindychangsy/volunteer-registration.git
git branch -M main

echo.
echo 正在將所有程式碼推送至 GitHub...
echo (若跳出 GitHub Sign in 視窗，請點擊綠色按鈕「Sign in with your browser」授權)
echo.
git push -u origin main

echo.
echo ========================================================
echo   推送完成！現在將自動為您開啟 Vercel 部署頁面 (https://vercel.com/new)
echo ========================================================
start https://vercel.com/new
pause
