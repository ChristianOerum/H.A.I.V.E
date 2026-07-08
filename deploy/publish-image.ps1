<#
.SYNOPSIS
  Build (and optionally push) the HAIVE Docker image as a multi-arch manifest.

.DESCRIPTION
  Reads the version from package.json and produces two tags: :<version> and :latest.
  Uses `docker buildx` so a single build serves both PC (linux/amd64) and
  Raspberry Pi (linux/arm64) targets from one manifest.

.PARAMETER User
  Docker Hub username (or full registry namespace, e.g. `ghcr.io/owner`).
  Defaults to $env:DOCKER_USER.

.PARAMETER Repo
  Image repository name. Default: haive.

.PARAMETER Platforms
  Comma-separated buildx platforms. Default: linux/amd64,linux/arm64
  Add linux/arm/v7 for 32-bit Raspberry Pi OS.

.PARAMETER Push
  Push the built manifest to the registry. Requires `docker login` first.
  When omitted the image is only built locally (single-arch --load).

.EXAMPLE
  # Local test build (single-arch, loaded into the local daemon)
  .\deploy\publish-image.ps1 -User yourname

.EXAMPLE
  # Multi-arch build + push to Docker Hub
  .\deploy\publish-image.ps1 -User yourname -Push
#>
[CmdletBinding()]
param(
  [string]$User      = $env:DOCKER_USER,
  [string]$Repo      = 'haive',
  [string]$Platforms = 'linux/amd64,linux/arm64',
  [switch]$Push
)

$ErrorActionPreference = 'Stop'

if (-not $User) {
  throw "Docker registry user not set. Pass -User <name> or set `$env:DOCKER_USER."
}

# Repo root = parent of this script.
$repoRoot = Resolve-Path (Join-Path $PSScriptRoot '..')
Push-Location $repoRoot
try {
  $pkg     = Get-Content 'package.json' -Raw | ConvertFrom-Json
  $version = $pkg.version
  if (-not $version) { throw "Could not read version from package.json." }

  $image      = "$User/$Repo"
  $tagVersion = "${image}:${version}"
  $tagLatest  = "${image}:latest"

  Write-Host ""
  Write-Host "==> HAIVE image build" -ForegroundColor Cyan
  Write-Host "    Image     : $image"
  Write-Host "    Version   : $version"
  Write-Host "    Platforms : $Platforms"
  Write-Host "    Mode      : $(if ($Push) { 'BUILD + PUSH' } else { 'BUILD (local --load)' })"
  Write-Host ""

  # Ensure a buildx builder exists and is selected.
  $builderName = 'haive-builder'
  $existing    = & docker buildx ls 2>$null | Select-String -SimpleMatch $builderName
  if (-not $existing) {
    Write-Host "==> Creating buildx builder '$builderName'..." -ForegroundColor Yellow
    & docker buildx create --name $builderName --use --bootstrap | Out-Null
  } else {
    & docker buildx use $builderName | Out-Null
  }

  $buildArgs = @(
    'buildx', 'build',
    '--platform', $Platforms,
    '-t', $tagVersion,
    '-t', $tagLatest
  )

  if ($Push) {
    $buildArgs += '--push'
  } else {
    # --load only supports a single platform; force the host's arch.
    $hostArch = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { 'linux/arm64' } else { 'linux/amd64' }
    Write-Host "==> Local build: overriding platforms to $hostArch (--load only supports one)." -ForegroundColor Yellow
    $buildArgs[[array]::IndexOf($buildArgs, '--platform') + 1] = $hostArch
    $buildArgs += '--load'
  }
  $buildArgs += '.'

  Write-Host "==> docker $($buildArgs -join ' ')" -ForegroundColor DarkGray
  & docker @buildArgs
  if ($LASTEXITCODE -ne 0) { throw "docker buildx failed with exit code $LASTEXITCODE." }

  Write-Host ""
  Write-Host "==> Done." -ForegroundColor Green
  Write-Host "    $tagVersion"
  Write-Host "    $tagLatest"
  if ($Push) {
    Write-Host ""
    Write-Host "Inspect the pushed manifest:" -ForegroundColor DarkGray
    Write-Host "  docker buildx imagetools inspect $tagLatest"
  }
}
finally {
  Pop-Location
}
