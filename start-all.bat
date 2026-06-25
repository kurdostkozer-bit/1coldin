@echo off
chcp 65001 >nul
echo 🚀 KurdBox - تشغيل كل الخدمات
echo ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
echo.

powershell -ExecutionPolicy Bypass -File "%~dp0start-all.ps1"

pause
