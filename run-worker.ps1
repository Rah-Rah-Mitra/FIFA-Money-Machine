# Start the analysis worker. Uses the isolated worker venv if present, else the system python.
# Usage:  .\run-worker.ps1            (loop forever)
#         .\run-worker.ps1 --once     (process one job and exit)
$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
$venvPy = Join-Path $root "worker\.venv\Scripts\python.exe"
$py = if (Test-Path $venvPy) { $venvPy } else { "python" }
Write-Host "worker python: $py"
& $py (Join-Path $root "worker\worker.py") @args
