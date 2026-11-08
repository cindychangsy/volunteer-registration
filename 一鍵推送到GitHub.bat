@echo off
cd /d "%~dp0"
echo ========================================================
echo   Pushing to GitHub: cindychangsy/volunteer-registration
echo ========================================================
git remote remove origin 2>nul
git remote add origin https://github.com/cindychangsy/volunteer-registration.git
git branch -M main
git push -u origin main
echo.
echo ========================================================
echo   Done! Opening Vercel deployment page...
echo ========================================================
start https://vercel.com/new
pause
