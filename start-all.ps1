# KurdBox - Start All Services

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$backendDir = Join-Path $scriptDir "backend"
$extensionDir = Join-Path $scriptDir "extension"

Write-Host "Starting KurdBox..." -ForegroundColor Cyan

if (-not (Test-Path $backendDir)) {
    Write-Host "Backend directory not found" -ForegroundColor Red
    exit 1
}

if (-not (Test-Path $extensionDir)) {
    Write-Host "Extension directory not found" -ForegroundColor Red
    exit 1
}

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

if (Test-Port 5001) {
    Write-Host "Backend already running on port 5001" -ForegroundColor Green
    $backendRunning = $true
} else {
    Write-Host "Starting backend..." -ForegroundColor Yellow
    $backendRunning = $false
}

if (-not $backendRunning) {
    try {
        Push-Location $backendDir
        if (Test-Path ".venv\Scripts\python.exe") {
            $python = ".venv\Scripts\python.exe"
        } else {
            $python = "python"
        }
        $arguments = @("-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", "5001", "--reload")
        $backendProcess = Start-Process -FilePath $python -ArgumentList $arguments -PassThru -WindowStyle Minimized
        Pop-Location
        
        # Wait for backend to be ready with retry logic
        $maxRetries = 15
        $retryCount = 0
        $backendReady = $false
        
        while ($retryCount -lt $maxRetries -and -not $backendReady) {
            Start-Sleep -Seconds 1
            if (Test-Port 5001) {
                $backendReady = $true
            }
            $retryCount++
        }
        
        if ($backendReady) {
            Write-Host "Backend started successfully" -ForegroundColor Green
        } else {
            Write-Host "Failed to start backend" -ForegroundColor Red
            exit 1
        }
    } catch {
        Write-Host "Error starting backend: $_" -ForegroundColor Red
        exit 1
    }
}

Write-Host "Choose an option:"
Write-Host "1. Start dev mode"
Write-Host "2. Reload extension"
Write-Host "3. Open VSCode"
Write-Host "4. Exit"

$choice = Read-Host "Enter choice (1-4)"

switch ($choice) {
    "1" {
        Push-Location $extensionDir
        & powershell -ExecutionPolicy Bypass -File ".\watch-reload.ps1"
        Pop-Location
    }
    "2" {
        Push-Location $extensionDir
        npm run quick-reload
        Pop-Location
    }
    "3" {
        code $scriptDir
    }
    "4" {
        exit 0
    }
    default {
        Write-Host "Invalid choice" -ForegroundColor Red
    }
}

Write-Host "KurdBox ready!" -ForegroundColor Green
