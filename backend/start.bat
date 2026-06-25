@echo off
cd /d %~dp0

if not exist ".env" (
    copy ".env.example" ".env"
    echo Created .env from .env.example
)

if not exist ".venv" (
    echo Creating virtual environment...
    python -m venv .venv
)

call .venv\Scripts\activate.bat
pip install -r requirements.txt -q

echo.
echo Starting KurdBox Backend on http://127.0.0.1:5001
echo Docs: http://127.0.0.1:5001/docs
echo.

python -m uvicorn app.main:app --host 127.0.0.1 --port 5001 --reload
