$ErrorActionPreference = 'Stop'
Push-Location (Split-Path (Split-Path $PSScriptRoot -Parent) -Parent)
try {
    $env:RUSTUP_TOOLCHAIN = 'stable-x86_64-pc-windows-msvc'
    # Updater signing happens only in .github/workflows/release.yml.
    # Never load the previous product's private key for ordinary packaging.
    pnpm exec tauri build --ci --bundles nsis --config src-tauri/tauri.fork.conf.json
    if ($LASTEXITCODE -ne 0) { throw "Windows build failed ($LASTEXITCODE)" }
} finally {
    Pop-Location
}
