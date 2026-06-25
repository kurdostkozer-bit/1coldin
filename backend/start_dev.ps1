# KurdBox Backend v2.0 — Dev Start (uses old venv which has all packages)
Set-Location $PSScriptRoot
$env:PYTHONPATH = $PSScriptRoot

# Use local venv
$python = ".venv\Scripts\python.exe"
if (-not (Test-Path $python)) {
    # Fallback: use system python
    $python = "python"
}

Write-Host "Starting KurdBox Backend v2.0 on http://127.0.0.1:5001"
Write-Host "Docs: http://127.0.0.1:5001/docs"
Write-Host ""

& $python -m uvicorn app.main:app --host 127.0.0.1 --port 5001 --reload
