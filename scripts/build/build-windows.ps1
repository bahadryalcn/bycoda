$ErrorActionPreference = 'Stop'
Push-Location (Split-Path (Split-Path $PSScriptRoot -Parent) -Parent)
try {
    $env:RUSTUP_TOOLCHAIN = 'stable-x86_64-pc-windows-msvc'
    # Updater signing happens only in .github/workflows/release.yml.
    # Never load the previous product's private key for ordinary packaging.
    $buildArguments = @('exec', 'tauri', 'build', '--ci', '--bundles', 'nsis', '--config', 'src-tauri/tauri.fork.conf.json')
    if ($env:BYCODA_WINDOWS_SIGNING_CERT_SHA1) {
        $signingConfig = Join-Path $PWD 'temp/local/windows-authenticode.json'
        New-Item -ItemType Directory -Path (Split-Path $signingConfig -Parent) -Force | Out-Null
        [IO.File]::WriteAllText($signingConfig, '{}', [Text.UTF8Encoding]::new($false))
        node scripts/release/windows-authenticode.mjs --config $signingConfig
        if ($LASTEXITCODE -ne 0) { throw 'Windows signing configuration failed.' }
        $buildArguments += @('--config', $signingConfig)
    }
    pnpm @buildArguments
    if ($LASTEXITCODE -ne 0) { throw "Windows build failed ($LASTEXITCODE)" }
} finally {
    Pop-Location
}
