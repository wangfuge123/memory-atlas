$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
$python = & (Join-Path $PSScriptRoot 'ensure-python.ps1')
& $python (Join-Path $PSScriptRoot 'prepare-release.py')
if ($LASTEXITCODE -ne 0) { throw 'Release packaging failed.' }
Write-Host ('Release package is in: ' + (Join-Path $projectRoot 'dist'))
