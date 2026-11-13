# Experimental process observation; only runs against the harness-owned database.
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$exe = Join-Path $root 'tools/duckdb.exe'
$db = Join-Path $root 'fixtures/proof.duckdb'
if (!(Test-Path -LiteralPath $exe) -or !(Test-Path -LiteralPath $db)) { throw 'Run setup first' }
$sql = "SET enable_external_access=false; SET memory_limit='128MB'; SET max_temp_directory_size='32MB'; SET threads=2; SELECT count(*) FROM registered_big a CROSS JOIN registered_big b"
$start = [System.Diagnostics.ProcessStartInfo]::new()
$start.FileName = $exe
$start.UseShellExecute = $false
$start.CreateNoWindow = $true
$start.RedirectStandardOutput = $true
$start.RedirectStandardError = $true
foreach ($arg in @('-readonly', $db, '-c', $sql)) { [void]$start.ArgumentList.Add($arg) }
$p = [System.Diagnostics.Process]::Start($start)
$watch = [System.Diagnostics.Stopwatch]::StartNew()
$peak = 0L
try {
  while (!$p.HasExited -and $watch.ElapsedMilliseconds -lt 1000) {
    $p.Refresh()
    if ($p.PeakWorkingSet64 -gt $peak) { $peak = $p.PeakWorkingSet64 }
    Start-Sleep -Milliseconds 25
  }
  if (!$p.HasExited) { $p.Kill($true); $p.WaitForExit() }
  $p.Refresh()
  if ($p.PeakWorkingSet64 -gt $peak) { $peak = $p.PeakWorkingSet64 }
  [pscustomobject]@{ elapsed_ms = $watch.ElapsedMilliseconds; peak_working_set_bytes = $peak; terminated = $p.ExitCode -ne 0 }
} finally { $p.Dispose() }
