# Free local studio on Windows: the model runs on this PC (WanGP), and any
# phone or computer on the same Wi-Fi can use the page.
#
#   $env:WANGP_ROOT = "C:\WanGP"; .\scripts\start-free-studio.ps1
#
# Optional: $env:WANGP_PYTHON (WanGP's python.exe), $env:PORT (3000),
# $env:WANGP_ARGS ("--attention sdpa --profile 4"), $env:APP_PASSWORD.
$ErrorActionPreference = "Stop"
Set-Location (Join-Path $PSScriptRoot "..")

if (-not $env:WANGP_ROOT) { throw "Set WANGP_ROOT to your WanGP folder (the one with wgp.py)" }
if (-not (Test-Path (Join-Path $env:WANGP_ROOT "wgp.py"))) { throw "No wgp.py in $env:WANGP_ROOT" }
$py = if ($env:WANGP_PYTHON) { $env:WANGP_PYTHON } else { "python" }
$port = if ($env:PORT) { $env:PORT } else { "3000" }

if (-not (Test-Path ".free-studio.env")) {
  $bytes = New-Object byte[] 24; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  "WANGP_TOKEN=" + (($bytes | ForEach-Object { $_.ToString("x2") }) -join "") | Set-Content ".free-studio.env"
}
$token = ((Get-Content ".free-studio.env") -replace "^WANGP_TOKEN=", "").Trim()

if (-not (Test-Path "node_modules")) { pnpm install --frozen-lockfile }
if (-not (Test-Path ".next")) { pnpm build }

$bridgeArgs = @("bridge/wangp_bridge.py", "--wangp-root", $env:WANGP_ROOT, "--token", $token, "--wangp-args", "$env:WANGP_ARGS")
$bridge = Start-Process -FilePath $py -ArgumentList $bridgeArgs -PassThru -NoNewWindow

Write-Host ""
Write-Host "  Free studio is starting. Open it on:"
Write-Host "    this computer:  http://localhost:$port"
Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
  Where-Object { $_.IPAddress -notmatch "^(127\.|169\.254\.)" } |
  ForEach-Object { Write-Host "    phone (Wi-Fi):  http://$($_.IPAddress):$port" }
Write-Host ""

try {
  $env:WANGP_URL = "http://127.0.0.1:7870"; $env:WANGP_TOKEN = $token
  pnpm start -H 0.0.0.0 -p $port
} finally {
  if ($bridge -and -not $bridge.HasExited) { Stop-Process -Id $bridge.Id }
}
