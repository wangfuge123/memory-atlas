$ErrorActionPreference = 'Stop'

# Only scan demo assets, even when launched from another folder.
$demoPath = Join-Path $PSScriptRoot 'demo-photos'
if (!(Test-Path -LiteralPath $demoPath -PathType Container)) {
    New-Item -ItemType Directory -Path $demoPath | Out-Null
}
$prefix = 'demo-photos/'
if (!(Get-ChildItem -LiteralPath $demoPath -File | Where-Object { $_.Extension -match '^\.(jpg|jpeg|png|webp)$' })) {
    $samples = Join-Path $PSScriptRoot 'sample-photos'
    if (Test-Path -LiteralPath $samples -PathType Container) { $demoPath = $samples; $prefix = 'sample-photos/' }
}
$files = @(Get-ChildItem -LiteralPath $demoPath -File |
    Where-Object { $_.Extension -match '^\.(jpg|jpeg|png|webp)$' } |
    Sort-Object Name |
    ForEach-Object { $prefix + [Uri]::EscapeDataString($_.Name) })
$json = ConvertTo-Json -InputObject $files -Compress
$source = "// Auto-generated image list. Re-run gen-manifest.bat after swapping images.`r`nexport const IMAGE_FILES = $json;`r`n"
$destination = Join-Path $PSScriptRoot 'images-manifest.js'
[System.IO.File]::WriteAllText($destination, $source, [System.Text.UTF8Encoding]::new($false))
Write-Host ('Updated images-manifest.js: {0} image(s).' -f $files.Count)
