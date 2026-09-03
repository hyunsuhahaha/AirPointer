$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location -LiteralPath $projectRoot

python -m PyInstaller --noconfirm --clean --workpath ".pyinstaller-work" --distpath "portable" "AirPointer.spec"
if ($LASTEXITCODE -ne 0) {
    throw "PyInstaller failed with exit code $LASTEXITCODE"
}
Write-Host "Portable build created at: $projectRoot\portable\AirPointer.exe"
