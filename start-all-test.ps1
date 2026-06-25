# KurdBox - Start All Services
# يشغل الخادم الخلفي والـ extension معاً

$ErrorActionPreference = "Stop"

# Get the script directory
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$backendDir = Join-Path $scriptDir "backend"
$extensionDir = Join-Path $scriptDir "extension"

Write-Host "🚀 KurdBox - تشغيل كل الخدمات" -ForegroundColor Cyan
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Gray
Write-Host ""

# Check if directories exist
if (-not (Test-Path $backendDir)) {
    Write-Host "❌ مجلد backend غير موجود" -ForegroundColor Red
    exit 1
}

if (-not (Test-Path $extensionDir)) {
    Write-Host "❌ مجلد extension غير موجود" -ForegroundColor Red
    exit 1
}

# Function to check if a port is in use
function Test-Port {
    param($port)
    try {
        $tcp = New-Object System.Net.Sockets.TcpClient
        $tcp.Connect("127.0.0.1", $port)
        $tcp.Close()
        return $true
    } catch {
        return $false
    }
}

# Check if backend is already running
if (Test-Port 5001) {
    Write-Host "✅ الخادم الخلفي يعمل بالفعل على المنفذ 5001" -ForegroundColor Green
    $backendRunning = $true
} else {
    Write-Host "🔄 تشغيل الخادم الخلفي..." -ForegroundColor Yellow
    $backendRunning = $false
}

# Start backend if not running
if (-not $backendRunning) {
    try {
        Push-Location $backendDir

        # Check if virtual environment exists
        if (Test-Path ".venv") {
            Write-Host "📦 تفعيل البيئة الافتراضية..." -ForegroundColor Gray
            & ".venv\Scripts\Activate.ps1"
        }

        # Start backend in background
        $backendProcess = Start-Process -FilePath "python" -ArgumentList "-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", "5001", "--reload" -PassThru -WindowStyle Minimized

        Pop-Location

        # Wait for backend to start
        Write-Host "⏳ انتظار بدء الخادم..." -ForegroundColor Gray
        Start-Sleep -Seconds 3

        if (Test-Port 5001) {
            Write-Host "✅ الخادم الخلفي بدأ بنجاح على http://127.0.0.1:5001" -ForegroundColor Green
        } else {
            Write-Host "❌ فشل بدء الخادم الخلفي" -ForegroundColor Red
            exit 1
        }
    } catch {
        Write-Host "❌ خطأ في تشغيل الخادم الخلفي: $_" -ForegroundColor Red
        exit 1
    }
}

Write-Host ""
Write-Host "🔧 الآن يمكنك اختيار:" -ForegroundColor Cyan
Write-Host "1. تشغيل وضع التطوير (auto-reload)" -ForegroundColor White
Write-Host "2. إعادة تحميل الـ extension يدوياً" -ForegroundColor White
Write-Host "3. فتح VSCode" -ForegroundColor White
Write-Host "4. إنهاء" -ForegroundColor White
Write-Host ""

$choice = Read-Host "اختر رقم (1-4)"

switch ($choice) {
    "1" {
        Write-Host ""
        Write-Host "🔄 تشغيل وضع التطوير (auto-reload)..." -ForegroundColor Yellow
        Push-Location $extensionDir
        & powershell -ExecutionPolicy Bypass -File ".\watch-reload.ps1"
        Pop-Location
    }
    "2" {
        Write-Host ""
        Write-Host "🔄 إعادة تحميل الـ extension..." -ForegroundColor Yellow
        Push-Location $extensionDir
        npm run quick-reload
        Pop-Location
        Write-Host "✅ تم إعادة التحميل" -ForegroundColor Green
    }
    "3" {
        Write-Host ""
        Write-Host "📝 فتح VSCode..." -ForegroundColor Yellow
        code $scriptDir
    }
    "4" {
        Write-Host ""
        Write-Host "👋 انتهى" -ForegroundColor Green
        exit 0
    }
    default {
        Write-Host "❌ اختيار غير صحيح" -ForegroundColor Red
    }
}

Write-Host ""
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Gray
Write-Host "✅ KurdBox جاهز!" -ForegroundColor Green
Write-Host "📱 Backend: http://127.0.0.1:5001" -ForegroundColor Gray
Write-Host "📚 Docs: http://127.0.0.1:5001/docs" -ForegroundColor Gray
Write-Host "💬 اضغط Ctrl+Shift+K في VSCode لفتح Chat" -ForegroundColor Gray
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Gray
