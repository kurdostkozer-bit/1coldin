# KurdBox Extension Auto-Reload Script

$extensionDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$vsixPath = Join-Path $extensionDir "kurdbox-1.0.2.vsix"

Write-Host "KurdBox Extension Auto-Reload" -ForegroundColor Cyan
Write-Host "Watching: $extensionDir" -ForegroundColor Gray
Write-Host "Press Ctrl+C to stop" -ForegroundColor Yellow
Write-Host ""

function Install-Extension {
    Write-Host "$(Get-Date -Format 'HH:mm:ss') Reinstalling..." -ForegroundColor Yellow
    
    Push-Location $extensionDir
    npm run compile
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Compilation failed" -ForegroundColor Red
        Pop-Location
        return
    }
    
    npm run package
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Packaging failed" -ForegroundColor Red
        Pop-Location
        return
    }
    
    Pop-Location
    
    if (Test-Path $vsixPath) {
        code --install-extension $vsixPath --force
        if ($LASTEXITCODE -eq 0) {
            Write-Host "$(Get-Date -Format 'HH:mm:ss') Installed successfully" -ForegroundColor Green
        } else {
            Write-Host "$(Get-Date -Format 'HH:mm:ss') Installation failed" -ForegroundColor Red
        }
    } else {
        Write-Host "$(Get-Date -Format 'HH:mm:ss') VSIX file not found" -ForegroundColor Red
    }
}

Write-Host "Initial installation..." -ForegroundColor Cyan
Install-Extension

$watcher = New-Object System.IO.FileSystemWatcher
$watcher.Path = $extensionDir
$watcher.IncludeSubdirectories = $true
$watcher.EnableRaisingEvents = $true

$lastChange = Get-Date

Register-ObjectEvent -InputObject $watcher -EventName Changed -Action {
    $path = $Event.SourceEventArgs.FullPath
    $extension = [System.IO.Path]::GetExtension($path)
    
    if ($extension -in @(".ts", ".json", ".html", ".css", ".js")) {
        $now = Get-Date
        $diff = ($now - $script:lastChange).TotalSeconds
        
        if ($diff -gt 2) {
            $script:lastChange = $now
            Write-Host "$(Get-Date -Format 'HH:mm:ss') Changed: $(Split-Path $path -Leaf)" -ForegroundColor Gray
            
            Start-Sleep -Seconds 2
            & $script:InstallFunction
        }
    }
} | Out-Null

$script:InstallFunction = ${function:Install-Extension}

Write-Host "Watching..." -ForegroundColor Green
Write-Host ""

try {
    while ($true) {
        Start-Sleep -Seconds 1
    }
} finally {
    $watcher.EnableRaisingEvents = $false
    Write-Host "Stopped watching" -ForegroundColor Yellow
}
