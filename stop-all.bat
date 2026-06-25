@echo off
chcp 65001 >nul
echo 🛑 KurdBox - إيقاف كل الخدمات
echo ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
echo.

powershell -ExecutionPolicy Bypass -File "%~dp0stop-all.ps1"

pause
