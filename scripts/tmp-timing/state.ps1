# TEMPORARY: snapshot machine state that could slow later Host tests.
param([string]$Label)
Write-Output "===== STATE $Label ====="
$temp = [IO.Path]::GetTempPath()
Write-Output "temp=$temp entries=$((Get-ChildItem -Force $temp -ErrorAction SilentlyContinue | Measure-Object).Count)"
Get-ChildItem -Force $temp -ErrorAction SilentlyContinue | Group-Object { ($_.Name -replace '[-_.][A-Za-z0-9]{4,}$','*') } | Sort-Object Count -Descending | Select-Object -First 15 | ForEach-Object { "  $($_.Count) $($_.Name)" }
foreach ($p in @($temp, (Split-Path $temp), (Split-Path (Split-Path $temp)), $env:USERPROFILE, 'C:\', 'D:\')) { if (Test-Path (Join-Path $p '.git')) { Write-Output "FOUND .git in $p" } }
$probe = Join-Path $temp ("bycoda-state-" + [guid]::NewGuid())
New-Item -ItemType Directory $probe | Out-Null
$sw = [Diagnostics.Stopwatch]::StartNew(); $top = & git -C $probe rev-parse --show-toplevel 2>&1; Write-Output "git rev-parse in temp child: $($sw.ElapsedMilliseconds)ms -> $top"
$sw = [Diagnostics.Stopwatch]::StartNew(); $ls = & git -C $probe ls-files --cached --others --exclude-standard -z -- . 2>&1; Write-Output "git ls-files in temp child: $($sw.ElapsedMilliseconds)ms -> $($ls | Select-Object -First 1)"
Remove-Item -Recurse -Force $probe
Get-Process | Where-Object { $_.ProcessName -match '^(node|git|pwsh|powershell|chrome|python|ssh|cmd|conhost|fsmonitor|bash|sh)' } | Sort-Object CPU -Descending | Select-Object -First 25 | ForEach-Object { "  proc $($_.ProcessName) pid=$($_.Id) cpu=$([math]::Round($_.CPU,1)) ws=$([math]::Round($_.WorkingSet64/1MB))MB start=$($_.StartTime)" }
$cpu = (Get-CimInstance Win32_Processor | Measure-Object -Property LoadPercentage -Average).Average
Write-Output "cpuLoad=$cpu%"
Get-ChildItem Env: | Where-Object { $_.Name -match '^GIT_' } | ForEach-Object { "  env $($_.Name)=$($_.Value)" }
& git config --global --list 2>&1 | ForEach-Object { "  gitcfg $_" }
