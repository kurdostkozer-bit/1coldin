# KurdBox Backend v2.0 — Start Script (PowerShell)
# Usage: .\start.ps1

Set-Location $PSScriptRoot

# Copy .env if doesn't exist
if (-not (Test-Path ".env")) {
    Copy-Item ".env.example" ".env"
    Write-Host "Created .env from .env.example — please fill in KURDOST_SECRET_KEY and KURDOST_ENC_KEY"
}

# Check if venv exists
if (-not (Test-Path ".venv")) {
    Write-Host "Creating virtual environment..."
    python -m venv .venv
}

# Activate venv and install deps
& .\.venv\Scripts\Activate.ps1
pip install -r requirements.txt -q

Write-Host ""
Write-Host "Starting KurdBox Backend on http://127.0.0.1:5001"
Write-Host "Docs: http://127.0.0.1:5001/docs"
Write-Host ""

python -m uvicorn app.main:app --host 127.0.0.1 --port 5001 --reload
