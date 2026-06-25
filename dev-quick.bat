@echo off
chcp 65001 >nul
echo 🚀 KurdBox - وضع التطوير السريع
echo ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
echo.
echo تشغيل الخادم الخلفي + extension مع auto-reload...
echo.

powershell -ExecutionPolicy Bypass -Command "cd backend; if (Test-Path .venv) { .\.venv\Scripts\Activate.ps1 }; Start-Process python -ArgumentList '-m','uvicorn','app.main:app','--host','127.0.0.1','--port','5001','--reload' -WindowStyle Minimized; Start-Sleep -Seconds 2; cd extension; npm run dev"

pause
