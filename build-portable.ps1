$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location -LiteralPath $projectRoot

python -m PyInstaller --noconfirm --clean --workpath ".pyinstaller-work" --distpath "portable" "AirPointer.spec"
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
