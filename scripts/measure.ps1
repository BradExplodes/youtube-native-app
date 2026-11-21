# Samples CPU and memory of the whole app: the app process plus every WebView2 process under it.
# Memory is the private working set, the number Task Manager shows.
# Usage:  powershell -File scripts/measure.ps1 [-Seconds 60] [-Detail]
param(
  [int]$Seconds = 60,
  [switch]$Detail,
  [string]$Name = "youtube-music-native"
)

$app = Get-Process -Name $Name -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $app) { Write-Error "$Name is not running"; exit 1 }

# The app and everything it started (WebView2's browser, GPU, renderer… processes).
$procs = Get-CimInstance Win32_Process -Property ProcessId, ParentProcessId, CommandLine
$ids = [System.Collections.Generic.HashSet[int]]::new()
[void]$ids.Add($app.Id)
do {
  $added = $false
  foreach ($p in $procs) {
    if ($ids.Contains([int]$p.ParentProcessId) -and $ids.Add([int]$p.ProcessId)) { $added = $true }
  }
} while ($added)

function Get-Sample {
  $s = @{}
  foreach ($p in Get-CimInstance Win32_PerfRawData_PerfProc_Process -Property IDProcess, WorkingSetPrivate, PercentProcessorTime, Timestamp_Sys100NS) {
    if ($ids.Contains([int]$p.IDProcess)) { $s[[int]$p.IDProcess] = $p }
  }
  return $s
}

$cores = [Environment]::ProcessorCount
$prev = Get-Sample
$cpuSamples = @(); $memSamples = @()
$perProcCpu = @{}

for ($i = 0; $i -lt $Seconds; $i++) {
  Start-Sleep -Seconds 1
  $now = Get-Sample
  $cpu = 0.0; $mem = 0
  foreach ($id in $now.Keys) {
    $n = $now[$id]
    $mem += $n.WorkingSetPrivate
    if ($prev.ContainsKey($id)) {
      $p = $prev[$id]
      $elapsed = [double]($n.Timestamp_Sys100NS - $p.Timestamp_Sys100NS)
      if ($elapsed -gt 0) {
        # CPU as a share of the whole machine, like Task Manager.
        $c = ($n.PercentProcessorTime - $p.PercentProcessorTime) / $elapsed / $cores * 100
        $cpu += $c
        $perProcCpu[$id] = ($perProcCpu[$id] + $c)
      }
    }
  }
  $prev = $now
  $cpuSamples += $cpu
  $memSamples += $mem / 1MB
}

$cpuStats = $cpuSamples | Measure-Object -Average -Maximum
"{0} processes | CPU avg {1:N2}% (max {2:N2}%) | memory {3:N0} MB" -f `
  $ids.Count, $cpuStats.Average, $cpuStats.Maximum, ($memSamples | Measure-Object -Average).Average

if ($Detail) {
  $procs | Where-Object { $ids.Contains([int]$_.ProcessId) } | ForEach-Object {
    $type = if ($_.CommandLine -match '--type=([\w-]+)') { $Matches[1] } else { 'main' }
    if ($_.CommandLine -match '--utility-sub-type=\w+\.mojom\.(\w+)') { $type = $Matches[1] }
    $id = [int]$_.ProcessId
    [pscustomobject]@{
      Id      = $id
      Type    = $type
      'MB'    = [int]($prev[$id].WorkingSetPrivate / 1MB)
      'CPU %' = [math]::Round($perProcCpu[$id] / $Seconds, 2)
    }
  } | Sort-Object MB -Descending | Format-Table -AutoSize | Out-String
}
