$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location -LiteralPath $projectRoot

# UPX roughly halves the size of the big native DLLs (cv2, mediapipe's
# bundled OpenCV, ...), which matters because the built exe needs to stay
# under GitHub's 100MB per-file limit to be committed directly. Installed
# via `winget install UPX.UPX`; PyInstaller silently skips compression if
# it can't find it, so this is best-effort.
$upxDir = $null
$upxCommand = Get-Command upx -ErrorAction SilentlyContinue
if ($upxCommand) {
    $upxDir = Split-Path -Parent $upxCommand.Source
} else {
    $upxCandidate = Get-ChildItem -Path "$env:LOCALAPPDATA\Microsoft\WinGet\Packages\UPX.UPX_*\upx-*" -Directory -ErrorAction SilentlyContinue |
        Sort-Object Name -Descending | Select-Object -First 1
    if ($upxCandidate) { $upxDir = $upxCandidate.FullName }
}

$pyinstallerArgs = @("--noconfirm", "--clean", "--workpath", ".pyinstaller-work", "--distpath", "portable")
if ($upxDir) {
    Write-Host "Using UPX from: $upxDir"
    $pyinstallerArgs += @("--upx-dir", $upxDir)
} else {
    Write-Warning "UPX not found (winget install UPX.UPX) -- building without compression, exe will be larger."
}
$pyinstallerArgs += "AirPointer.spec"

python -m PyInstaller @pyinstallerArgs
if ($LASTEXITCODE -ne 0) {
    throw "PyInstaller failed with exit code $LASTEXITCODE"
}

$exePath = Join-Path $projectRoot "portable\AirPointer.exe"

# Sign the build so it isn't a brand-new unrecognized binary on every rebuild
# (Windows Smart App Control blocks unsigned/unrecognized exes). This only
# creates a cert in the current user's personal store and signs the file --
# it does not touch the system trust store. See README for the one-time,
# user-run step that makes Windows actually trust this certificate.
$cert = Get-ChildItem Cert:\CurrentUser\My -CodeSigningCert -ErrorAction SilentlyContinue |
    Where-Object { $_.Subject -eq "CN=AirPointer Dev" } | Select-Object -First 1
if (-not $cert) {
    Write-Host "Creating a local code-signing certificate (AirPointer Dev)..."
    $cert = New-SelfSignedCertificate -Type CodeSigningCert -Subject "CN=AirPointer Dev" `
        -CertStoreLocation Cert:\CurrentUser\My -NotAfter (Get-Date).AddYears(5) `
        -KeyExportPolicy Exportable -KeyUsage DigitalSignature -FriendlyName "AirPointer Dev Signing"
    $cerPath = Join-Path $projectRoot "AirPointer-dev-cert.cer"
    Export-Certificate -Cert $cert -FilePath $cerPath | Out-Null
    Write-Host "Exported $cerPath -- see README for the one-time trust step."
}

try {
    $signed = Set-AuthenticodeSignature -FilePath $exePath -Certificate $cert `
        -TimestampServer "http://timestamp.digicert.com" -HashAlgorithm SHA256
    if ($signed.Status -ne "Valid" -and $signed.Status -ne "UnknownError") {
        Write-Warning "Signing status: $($signed.Status) -- $($signed.StatusMessage)"
    }
} catch {
    Write-Warning "Could not sign the exe (continuing unsigned): $($_.Exception.Message)"
}

Write-Host "Portable build created at: $exePath"
