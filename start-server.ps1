param([switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
$env:PYTHONUTF8 = '1'
$projectPath = [System.IO.Path]::GetFullPath($PSScriptRoot).TrimEnd('\')
& (Join-Path $PSScriptRoot 'gen-manifest.ps1')
# Keep this script ASCII so Windows PowerShell 5.1 reads it correctly without a BOM.
$libraryFolderName = -join ([char[]]@(0x56DE, 0x5FC6, 0x5E93))
$sha = [System.Security.Cryptography.SHA256]::Create()
try { $projectId = ([BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($projectPath)))).Replace('-', '').ToLowerInvariant() }
finally { $sha.Dispose() }

function Test-ProjectServer([int]$Port) {
    try {
        $health = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/__sphere_health" -TimeoutSec 1
        if (!($health.ready -and $health.project -eq $projectId -and $health.storage -eq 'filesystem' -and $health.apiVersion -eq 1)) { return $false }
        $library = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/api/library" -TimeoutSec 1
        return ($library.path -eq (Join-Path $projectPath $libraryFolderName))
    } catch { return $false }
}

$selectedPort = $null
$freePort = $null
foreach ($port in 8000..8010) {
    $probe = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, $port)
    $available = $false
    try { $probe.Start(); $available = $true } catch {} finally { $probe.Stop() }
    if ($available) {
        if ($null -eq $freePort) { $freePort = $port }
        continue
    }
    if (Test-ProjectServer $port) { $selectedPort = $port; break }
    # Check occupied ports only; unused ports need no HTTP timeout.
}

if ($null -eq $selectedPort) {
    if ($null -eq $freePort) { throw 'Ports 8000-8010 are occupied. Close an unused local server and retry.' }
    $candidates = @(
        Join-Path $projectPath 'runtime\python\python.exe'
        Get-Command python.exe, python3.exe -CommandType Application -ErrorAction SilentlyContinue |
            Where-Object { $_.Source -notlike '*\Microsoft\WindowsApps\*' } |
            Select-Object -ExpandProperty Source
    )
    $python = $null
    foreach ($candidate in ($candidates | Select-Object -Unique)) {
        if (Test-Path -LiteralPath $candidate -PathType Leaf) {
            $version = & $candidate -c 'import sys; assert sys.version_info >= (3, 10); print(sys.version)' 2>&1
            if ($LASTEXITCODE -eq 0 -and "$version" -match '^3\.') { $python = $candidate; break }
        }
    }
    if (!$python) { $python = & (Join-Path $PSScriptRoot 'scripts\ensure-python.ps1') }
    $selectedPort = $freePort
    $logBase = Join-Path $env:TEMP ("gesture-sphere-" + $projectId.Substring(0, 12) + "-$selectedPort")
    $arguments = @('"' + (Join-Path $projectPath 'serve.py') + '"', '--port', "$selectedPort")
    $process = Start-Process -FilePath $python -ArgumentList $arguments -WorkingDirectory $projectPath -WindowStyle Hidden -PassThru -RedirectStandardOutput "$logBase.out.log" -RedirectStandardError "$logBase.err.log"
    $deadline = [DateTime]::UtcNow.AddSeconds(12)
    do {
        if (Test-ProjectServer $selectedPort) { break }
        if ($process.HasExited) { throw "Local server exited. See $logBase.err.log" }
        Start-Sleep -Milliseconds 150
    } while ([DateTime]::UtcNow -lt $deadline)
    if (!(Test-ProjectServer $selectedPort)) { throw "Local server did not become ready. See $logBase.err.log" }
}

$url = "http://127.0.0.1:$selectedPort/index.html"
Write-Host "Server ready: $url"
Write-Host 'The server runs in the background. Closing this launcher will not stop it.'
if (!$NoBrowser) { Start-Process -FilePath $url -WindowStyle Hidden }
