[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$BundlePath,

  [Parameter(Mandatory = $true)]
  [string[]]$Server,

  [string]$RemoteUser = 'root',

  [string]$RemoteDirectory = '/var/lib/planemem/offline-images',

  [string]$SshKeyPath
)

$ErrorActionPreference = 'Stop'

function Require-Command {
  param([Parameter(Mandatory = $true)][string]$Name)

  $command = Get-Command $Name -ErrorAction SilentlyContinue
  if ($null -eq $command) {
    throw "Required command '$Name' was not found."
  }

  return $command
}

$scp = Require-Command -Name 'scp'
$ssh = Require-Command -Name 'ssh'
$bundle = [System.IO.Path]::GetFullPath($BundlePath)

if (-not (Test-Path -LiteralPath $bundle -PathType Leaf)) {
  throw "Bundle does not exist: $bundle"
}

$hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $bundle).Hash.ToLowerInvariant()
$fileName = [System.IO.Path]::GetFileName($bundle)
$sshArgs = @()
if ($SshKeyPath) {
  $key = [System.IO.Path]::GetFullPath($SshKeyPath)
  if (-not (Test-Path -LiteralPath $key -PathType Leaf)) {
    throw "SSH key does not exist: $key"
  }
  $sshArgs += @('-i', $key)
}

foreach ($hostName in $Server) {
  $target = "$RemoteUser@$hostName"
  & $ssh.Source @sshArgs $target "mkdir -p '$RemoteDirectory'"
  if ($LASTEXITCODE -ne 0) {
    throw "Unable to prepare offline image directory on $hostName."
  }

  & $scp.Source @sshArgs $bundle "${target}:$RemoteDirectory/$fileName"
  if ($LASTEXITCODE -ne 0) {
    throw "Unable to copy $fileName to $hostName."
  }

  $remoteHash = & $ssh.Source @sshArgs $target "sha256sum '$RemoteDirectory/$fileName' | cut -d ' ' -f 1"
  if ($LASTEXITCODE -ne 0 -or $remoteHash.Trim() -ne $hash) {
    throw "SHA256 mismatch on $hostName. local=$hash remote=$($remoteHash.Trim())"
  }

  Write-Output "${hostName}: copied $fileName sha256=$hash"
}
