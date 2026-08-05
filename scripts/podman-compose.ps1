param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('up', 'down')]
  [string]$Action
)

$command = Get-Command podman -ErrorAction SilentlyContinue
$podman = if ($command) {
  $command.Source
} else {
  Join-Path $env:LOCALAPPDATA 'Programs/Podman/podman.exe'
}

if (-not (Test-Path -LiteralPath $podman)) {
  throw 'Podman CLI was not found. Start Podman Desktop and finish machine setup first.'
}

if ($Action -eq 'up') {
  & $podman compose -f compose.yaml up -d
} else {
  & $podman compose -f compose.yaml down
}

exit $LASTEXITCODE
