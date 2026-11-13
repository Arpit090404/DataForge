$experimentRoot = [IO.Path]::GetFullPath($PSScriptRoot)
$runs = [IO.Path]::GetFullPath((Join-Path $experimentRoot 'runs'))
if (!$runs.StartsWith($experimentRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Refusing to remove a path outside the experiment directory.'
}
if (Test-Path -LiteralPath $runs) { Remove-Item -LiteralPath $runs -Recurse -Force }
$results = Join-Path $experimentRoot 'results.json'
if (Test-Path -LiteralPath $results) { Remove-Item -LiteralPath $results -Force }
