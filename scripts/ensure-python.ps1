$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
$runtimeRoot = Join-Path $projectRoot 'runtime'
$destination = Join-Path $runtimeRoot 'python'
$pythonPath = Join-Path $destination 'python.exe'
$spec = (Get-Content -LiteralPath (Join-Path $projectRoot 'resources.lock.json') -Raw | ConvertFrom-Json).resources.python
if (Test-Path -LiteralPath $pythonPath) {
    & $pythonPath -c 'import sys, ssl, http.server; assert sys.version_info >= (3, 10)' 2>$null
    if ($LASTEXITCODE -eq 0) { return $pythonPath }
}
if (![Environment]::Is64BitOperatingSystem) { throw 'This release requires 64-bit Windows 10 or later.' }
New-Item -ItemType Directory -Force -Path $runtimeRoot | Out-Null
$archive = Join-Path $runtimeRoot 'python-download.zip'
$staging = Join-Path $runtimeRoot ('python-staging-' + [guid]::NewGuid().ToString('N'))
try {
    Write-Host 'First launch: preparing portable Python from python.org (about 11 MB)...'
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    Invoke-WebRequest -Uri $spec.url -OutFile $archive -UseBasicParsing -TimeoutSec 120
    $hasher = [Security.Cryptography.SHA256]::Create()
    $stream = [IO.File]::OpenRead($archive)
    try { $digest = ([BitConverter]::ToString($hasher.ComputeHash($stream))).Replace('-', '').ToLowerInvariant() }
    finally { $stream.Dispose(); $hasher.Dispose() }
    if ($digest -ne $spec.sha256) {
        throw 'Python download failed SHA256 verification. Retry on a trusted network.'
    }
    [void][Reflection.Assembly]::LoadWithPartialName('System.IO.Compression.FileSystem')
    [IO.Compression.ZipFile]::ExtractToDirectory($archive, $staging)
    [IO.File]::WriteAllText((Join-Path $staging 'python313._pth'), "python313.zip`n.`n..\..`n", [Text.Encoding]::ASCII)
    [IO.File]::WriteAllText((Join-Path $staging '.archive-sha256'), $spec.sha256, [Text.Encoding]::ASCII)
    # Existing broken runtimes are kept for diagnosis instead of overwritten.
    if (Test-Path -LiteralPath $destination) {
        $previous = Join-Path $runtimeRoot ('python-previous-' + [guid]::NewGuid().ToString('N'))
        foreach ($target in @($destination, $previous, $staging)) {
            if (![IO.Path]::GetFullPath($target).StartsWith([IO.Path]::GetFullPath($runtimeRoot) + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Invalid runtime path.' }
        }
        Move-Item -LiteralPath $destination -Destination $previous
    }
    Move-Item -LiteralPath $staging -Destination $destination
    & $pythonPath -c 'import sys, ssl, http.server; assert sys.version_info >= (3, 10)'
    if ($LASTEXITCODE -ne 0) { throw 'Portable Python could not run on this computer.' }
    return $pythonPath
} catch {
    throw ('Could not prepare Python. Check your network or use the complete Windows release ZIP. ' + $_.Exception.Message)
} finally {
    if (Test-Path -LiteralPath $archive) { Remove-Item -LiteralPath $archive -Force }
}
