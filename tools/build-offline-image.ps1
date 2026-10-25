[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$DockerfilePath,

  [Parameter(Mandatory = $true)]
  [string]$ContextPath,

  [Parameter(Mandatory = $true)]
  [string]$ImageReference,

  [string]$BundleDirectory = 'artifacts/offline-images',

  [string[]]$BuildArgument = @(),

  [switch]$StageRuntime,

  [switch]$SkipChecks
)

$ErrorActionPreference = 'Stop'

function Resolve-RepoPath {
  param([Parameter(Mandatory = $true)][string]$Path)

  if ([System.IO.Path]::IsPathRooted($Path)) {
    return [System.IO.Path]::GetFullPath($Path)
  }

  return [System.IO.Path]::GetFullPath((Join-Path (Get-Location) $Path))
}

function Resolve-DockerCommand {
  $command = Get-Command docker -ErrorAction SilentlyContinue
  if ($null -ne $command) {
    return $command
  }

  $candidates = @(
    (Join-Path $env:LOCALAPPDATA 'Programs/DockerDesktop/resources/bin/docker.exe'),
    'C:/Program Files/Docker/Docker/resources/bin/docker.exe',
    'C:/ProgramData/DockerDesktop/version-bin/docker.exe'
  )
  foreach ($candidate in $candidates) {
    if (Test-Path -LiteralPath $candidate -PathType Leaf) {
      return Get-Command $candidate
    }
  }

  throw "Required command 'docker' was not found. Start a local Docker/Podman-compatible engine and ensure its CLI is on PATH."
}

function Require-Command {
  param([Parameter(Mandatory = $true)][string]$Name)

  $command = Get-Command $Name -ErrorAction SilentlyContinue
  if ($null -eq $command) {
    throw "Required command '$Name' was not found."
  }

  return $command
}

function Compress-Gzip {
  param(
    [Parameter(Mandatory = $true)][string]$InputPath,
    [Parameter(Mandatory = $true)][string]$OutputPath
  )

  $inputStream = [System.IO.File]::OpenRead($InputPath)
  $outputStream = [System.IO.File]::Create($OutputPath)
  try {
    $gzipStream = [System.IO.Compression.GzipStream]::new(
      $outputStream,
      [System.IO.Compression.CompressionMode]::Compress
    )
    try {
      $inputStream.CopyTo($gzipStream)
    } finally {
      $gzipStream.Dispose()
    }
  } finally {
    $inputStream.Dispose()
    $outputStream.Dispose()
  }
}

$docker = Resolve-DockerCommand
$dockerDirectory = Split-Path -Parent $docker.Source
if (($env:Path -split ';') -notcontains $dockerDirectory) {
  $env:Path = "$dockerDirectory;$env:Path"
}
$dockerfile = Resolve-RepoPath -Path $DockerfilePath
$context = Resolve-RepoPath -Path $ContextPath
$bundle = Resolve-RepoPath -Path $BundleDirectory

if (-not (Test-Path -LiteralPath $dockerfile -PathType Leaf)) {
  throw "Dockerfile does not exist: $dockerfile"
}

if (-not (Test-Path -LiteralPath $context -PathType Container)) {
  throw "Build context does not exist: $context"
}

if (-not $SkipChecks) {
  & $docker.Source info | Out-Host
  if ($LASTEXITCODE -ne 0) {
    throw 'The local container engine is not reachable. The image was not built.'
  }

  $pnpm = Get-Command pnpm -ErrorAction SilentlyContinue
  if ($null -eq $pnpm) {
    throw 'Required command pnpm was not found. Run the repository build checks before exporting an image.'
  }

  & $pnpm.Source run build
  if ($LASTEXITCODE -ne 0) {
    throw 'pnpm build failed. The image was not built.'
  }

  if ($StageRuntime) {
    $node = Require-Command -Name 'node'
    & $node.Source tools/stage-runtime.mjs --output artifacts/runtime
    if ($LASTEXITCODE -ne 0) {
      throw 'Runtime staging failed. The image was not built.'
    }
  }
} elseif ($StageRuntime) {
  $node = Require-Command -Name 'node'
  & $node.Source tools/stage-runtime.mjs --output artifacts/runtime
  if ($LASTEXITCODE -ne 0) {
    throw 'Runtime staging failed. The image was not built.'
  }
}

New-Item -ItemType Directory -Force -Path $bundle | Out-Null

$safeName = ($ImageReference -replace '[^A-Za-z0-9_.-]', '_')
$archive = Join-Path $bundle "$safeName.tar"
$compressed = "$archive.gz"
$manifestPath = Join-Path $bundle "$safeName.manifest.json"

$buildArguments = @()
foreach ($argument in $BuildArgument) {
  $buildArguments += @('--build-arg', $argument)
}

& $docker.Source build --pull=false --provenance=false @buildArguments --tag $ImageReference --file $dockerfile $context
if ($LASTEXITCODE -ne 0) {
  throw 'docker build failed. No offline bundle was exported.'
}

$inspectJson = & $docker.Source image inspect $ImageReference --format '{{json .}}'
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($inspectJson)) {
  throw "Unable to inspect built image '$ImageReference'."
}

$inspect = $inspectJson | ConvertFrom-Json
$repoDigest = @($inspect.RepoDigests) | Select-Object -First 1
$imageId = [string]$inspect.Id
if ([string]::IsNullOrWhiteSpace($imageId)) {
  throw "Built image '$ImageReference' did not report an image ID."
}

if ($repoDigest -and $repoDigest -match '@(sha256:[0-9a-f]+)$') {
  $repository = [System.Text.RegularExpressions.Regex]::Replace($ImageReference, ':[^/:]+$', '')
  $repoDigest = "$repository@$($matches[1])"
}

& $docker.Source save --output $archive $ImageReference
if ($LASTEXITCODE -ne 0) {
  throw 'docker save failed. The offline bundle is incomplete.'
}

Compress-Gzip -InputPath $archive -OutputPath $compressed
Remove-Item -LiteralPath $archive -Force

$sha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $compressed).Hash.ToLowerInvariant()
$manifest = [ordered]@{
  schema_version = 1
  image = $ImageReference
  image_id = $imageId
  repo_digest = if ($repoDigest) { [string]$repoDigest } else { $null }
  archive = [System.IO.Path]::GetFileName($compressed)
  archive_sha256 = $sha256
  built_at_utc = [DateTime]::UtcNow.ToString('o')
  dockerfile = $dockerfile
  context = $context
  source_revision = (& git rev-parse HEAD 2>$null)
}

$manifestJson = $manifest | ConvertTo-Json -Depth 6
[System.IO.File]::WriteAllText(
  $manifestPath,
  $manifestJson,
  [System.Text.UTF8Encoding]::new($false)
)
Write-Output "Offline image bundle: $compressed"
Write-Output "Manifest: $manifestPath"
Write-Output "Archive SHA256: $sha256"
if ($repoDigest) {
  Write-Output "Image digest: $repoDigest"
}
