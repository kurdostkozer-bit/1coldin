# KurdBox - Stop All Services
# يوقف كل الخدمات (backend, extension watch processes)

$ErrorActionPreference = "Stop"

Write-Host "🛑 KurdBox - إيقاف كل الخدمات" -ForegroundColor Cyan
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Gray
Write-Host ""

# Function to kill process by name
function Stop-ProcessByName {
    param($processName)
    $processes = Get-Process -Name $processName -ErrorAction SilentlyContinue
    if ($processes) {
        Write-Host "🛑 إيقاف $processName..." -ForegroundColor Yellow
        $processes | Stop-Process -Force
        Write-Host "✅ تم إيقاف $processName" -ForegroundColor Green
    } else {
        Write-Host "ℹ️ $processName غير يعمل" -ForegroundColor Gray
    }
}

# Stop backend (uvicorn/python)
Stop-ProcessByName "python"
Stop-ProcessByName "uvicorn"

# Stop extension watch processes
Stop-ProcessByName "node"
Stop-ProcessByName "powershell"

# Kill processes on port 5001
try {
    $portProcess = Get-NetTCPConnection -LocalPort 5001 -ErrorAction SilentlyContinue | 
                   Select-Object -ExpandProperty OwningProcess -ErrorAction SilentlyContinue
    if ($portProcess) {
        Write-Host "🛑 إيقاف العملية على المنفذ 5001..." -ForegroundColor Yellow
        Stop-Process -Id $portProcess -Force
        Write-Host "✅ تم إيقاف العملية على المنفذ 5001" -ForegroundColor Green
    }
} catch {
    Write-Host "ℹ️ لا توجد عمليات على المنفذ 5001" -ForegroundColor Gray
}

Write-Host ""
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Gray
Write-Host "✅ تم إيقاف كل الخدمات" -ForegroundColor Green
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Gray
