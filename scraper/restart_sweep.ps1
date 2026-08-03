# Safe restart for the FIND IT sweep supervisor.
#
# Duplicate supervisors corrupt shared state (each walks the city list on its
# own and they fight over the same files). The lock alone is not enough if a
# stale lock gets removed while the owner is still alive — which is exactly how
# duplicates happened. So: ALWAYS kill first, PROVE nothing is left, and only
# then clear the lock and launch.
#
# Usage:  powershell -ExecutionPolicy Bypass -File restart_sweep.ps1

$ErrorActionPreference = 'SilentlyContinue'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$lock = Join-Path $root 'sweeps\supervisor.lock'

Write-Host 'stopping any running supervisor...'
for ($i = 0; $i -lt 6; $i++) {
    # NOTE: the interpreter here is python3.13.exe (Windows Store Python), NOT
    # python.exe — filtering on 'python.exe' silently misses the supervisor.
    # CommandLine can also be unreadable, so match on name and fall back to
    # killing the parent of any live gmaps.exe.
    Get-CimInstance Win32_Process |
        Where-Object { $_.Name -like 'python*' -and $_.CommandLine -match 'sweep\.py' } |
        ForEach-Object { & taskkill /PID $_.ProcessId /T /F 2>&1 | Out-Null }
    Get-CimInstance Win32_Process -Filter "Name='gmaps.exe'" |
        ForEach-Object { & taskkill /PID $_.ParentProcessId /T /F 2>&1 | Out-Null }
    Get-CimInstance Win32_Process -Filter "Name='cmd.exe'" |
        Where-Object { $_.CommandLine -match 'run_sweep' } |
        ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
    Get-Process gmaps | Stop-Process -Force
    Start-Sleep -Seconds 3
    $py = @(Get-CimInstance Win32_Process |
            Where-Object { $_.Name -like 'python*' -and $_.CommandLine -match 'sweep\.py' }).Count
    $gm = @(Get-Process gmaps).Count
    if ($py -eq 0 -and $gm -eq 0) { break }
    Write-Host "  still alive: python=$py gmaps=$gm (retry $($i+1))"
}

$py = @(Get-CimInstance Win32_Process |
        Where-Object { $_.Name -like 'python*' -and $_.CommandLine -match 'sweep\.py' }).Count
if ($py -gt 0) {
    Write-Host "ABORT: $py supervisor(s) refuse to die — launching now would duplicate. Investigate first."
    exit 1
}

Remove-Item $lock -Force
Get-ChildItem (Join-Path $root 'sweeps\*\*.json.tmp') | ForEach-Object {
    try { Remove-Item $_ -Force } catch { }   # locked tmp = harmless, overwritten later
}

$cmd = Join-Path $root 'run_sweep.cmd'
$r = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{
    CommandLine      = "cmd.exe /c `"$cmd`""
    CurrentDirectory = $root
}
Write-Host "launched: rc=$($r.ReturnValue) pid=$($r.ProcessId)"
Write-Host "watch:  Get-Content '$root\sweeps\progress.log' -Tail 5 -Wait"
