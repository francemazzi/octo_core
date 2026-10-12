# Authenticode signing of Octo Core Windows binaries with Azure Artifact Signing (signtool + dlib).
# Dot-source this file for its functions, or run it with -Path to sign every .exe/.dll/.node under
# a folder and write a JSON report. Valid existing signatures are kept; invalid ones and PE files
# with an unexpected extension stop the release.
param(
  [string]$Path,
  [string]$ReportPath,
  [switch]$VerifyOnly,
  [string]$SignToolPath = $env:OCTO_SIGNTOOL_PATH,
  [string]$DlibPath = $env:OCTO_AZURE_CODESIGN_DLIB_PATH,
  [string]$MetadataPath = $env:OCTO_AZURE_CODESIGN_METADATA_PATH
)

$script:SignableExtensions = @('.exe', '.dll', '.node')
$script:TimestampUrl = 'http://timestamp.acs.microsoft.com'

function Write-JsonUtf8NoBom {
  param([object]$Value, [string]$Path, [int]$Depth = 6)
  # signtool's /dmdf reader rejects a UTF-8 BOM, so never use Set-Content -Encoding utf8 here.
  $json = $Value | ConvertTo-Json -Depth $Depth
  [System.IO.File]::WriteAllText($Path, $json, [System.Text.UTF8Encoding]::new($false))
}

function Add-GithubActionsLine {
  param([string]$FilePath, [string]$Line)
  if ([string]::IsNullOrWhiteSpace($FilePath)) { return }
  [System.IO.File]::AppendAllText($FilePath, "$Line`n", [System.Text.UTF8Encoding]::new($false))
}

function Add-CiEnvironment {
  param([string]$Name, [string]$Value)
  Set-Item -Path "Env:$Name" -Value $Value
  Add-GithubActionsLine -FilePath $env:GITHUB_ENV -Line "$Name=$Value"
}

function Add-CiOutput {
  param([string]$Name, [string]$Value)
  Add-GithubActionsLine -FilePath $env:GITHUB_OUTPUT -Line "$Name=$Value"
}

function Resolve-RequiredFile {
  param([string]$FilePath, [string]$Label)
  if ([string]::IsNullOrWhiteSpace($FilePath) -or -not (Test-Path -LiteralPath $FilePath -PathType Leaf)) {
    throw "$Label is missing: $FilePath"
  }
  return (Resolve-Path -LiteralPath $FilePath).ProviderPath
}

function Get-PeInfo {
  param([string]$FilePath)
  $reader = [System.IO.BinaryReader]::new([System.IO.File]::OpenRead($FilePath))
  try {
    if ($reader.BaseStream.Length -lt 2 -or $reader.ReadUInt16() -ne 0x5a4d) { return $null }
    if ($reader.BaseStream.Length -lt 64) { throw "Truncated PE: $FilePath" }
    $reader.BaseStream.Position = 60
    $offset = $reader.ReadUInt32()
    if ($offset + 152 -gt $reader.BaseStream.Length) { throw "Invalid PE offset: $FilePath" }
    $reader.BaseStream.Position = $offset
    if ($reader.ReadUInt32() -ne 0x4550) { throw "Invalid PE header: $FilePath" }
    $machine = $reader.ReadUInt16()
    $reader.BaseStream.Position = $offset + 24
    $magic = $reader.ReadUInt16()
    if ($magic -notin @(0x10b, 0x20b)) { throw "Invalid PE optional header: $FilePath" }
    $directories = if ($magic -eq 0x20b) { 112 } else { 96 }
    $reader.BaseStream.Position = $offset + 24 + $directories + 32
    $certificateOffset = $reader.ReadUInt32()
    $certificateSize = $reader.ReadUInt32()
    return @{ Machine = $machine; HasCertificate = ($certificateOffset -ne 0 -or $certificateSize -ne 0) }
  } finally { $reader.Dispose() }
}

function Test-AuthenticodeSignature {
  param([string]$FilePath)
  & $script:SignTool verify /pa /all /q $FilePath *> $null
  return $LASTEXITCODE -eq 0
}

function Invoke-UnsignedFile {
  param([string]$FilePath)
  & $script:SignTool sign /fd SHA256 /tr $script:TimestampUrl /td SHA256 /dlib $script:Dlib /dmdf $script:Metadata /d 'Octo Core' $FilePath | Out-Host
  if ($LASTEXITCODE -ne 0) { throw "SignTool failed: $FilePath" }
  if (-not (Test-AuthenticodeSignature $FilePath)) { throw "Signature verification failed: $FilePath" }
}

function Invoke-SignableFile {
  param([string]$FilePath, [string]$DisplayPath, [switch]$OnlyVerify)
  $pe = Get-PeInfo $FilePath
  $extension = [System.IO.Path]::GetExtension($FilePath).ToLowerInvariant()
  if (-not $pe) {
    if ($extension -in $script:SignableExtensions) { throw "Runtime file is not a PE: $FilePath" }
    return
  }
  if ($extension -notin $script:SignableExtensions) { throw "Uncovered PE extension: $FilePath" }
  $signature = Get-AuthenticodeSignature -LiteralPath $FilePath
  $valid = Test-AuthenticodeSignature $FilePath
  $action = 'preserved'
  if (-not $valid) {
    if ($OnlyVerify) { throw "Unsigned or invalid Authenticode signature: $FilePath" }
    if ($pe.HasCertificate -or $signature.Status -ne 'NotSigned') {
      throw "Existing signature is invalid; rebuild the dependency instead of replacing its signature: $FilePath"
    }
    Invoke-UnsignedFile $FilePath
    $signature = Get-AuthenticodeSignature -LiteralPath $FilePath
    $action = 'signed'
  }
  $script:Records.Add([ordered]@{
    path = $DisplayPath
    sha256 = (Get-FileHash -LiteralPath $FilePath -Algorithm SHA256).Hash.ToLowerInvariant()
    machine = ('0x{0:x4}' -f $pe.Machine)
    signer = $signature.SignerCertificate.Subject
    thumbprint = $signature.SignerCertificate.Thumbprint
    status = 'valid'
    action = $action
    verification = 'signtool verify /pa /all'
  })
}

function Invoke-SignablePath {
  param([string]$RootPath, [switch]$OnlyVerify)
  $root = Get-Item -LiteralPath $RootPath -ErrorAction Stop
  if (-not $root.PSIsContainer) {
    Invoke-SignableFile $root.FullName $root.Name -OnlyVerify:$OnlyVerify
    return
  }
  $files = @(Get-ChildItem -LiteralPath $root.FullName -File -Force -Recurse | Sort-Object FullName)
  foreach ($file in $files) {
    $relative = $file.FullName.Substring($root.FullName.TrimEnd('\', '/').Length + 1).Replace('\', '/')
    Invoke-SignableFile $file.FullName $relative -OnlyVerify:$OnlyVerify
  }
}

function Invoke-WindowsSigning {
  param([string]$Path, [string]$ReportPath, [bool]$OnlyVerify, [string]$SignToolPath, [string]$DlibPath, [string]$MetadataPath)
  $script:Records = [System.Collections.Generic.List[object]]::new()
  $script:SignTool = Resolve-RequiredFile $SignToolPath 'SignTool'
  if (-not $OnlyVerify) {
    $script:Dlib = Resolve-RequiredFile $DlibPath 'Azure signing library'
    $script:Metadata = Resolve-RequiredFile $MetadataPath 'Azure signing metadata'
  }
  $result = 'failed'
  $failure = $null
  try {
    Invoke-SignablePath $Path -OnlyVerify:$OnlyVerify
    if ($script:Records.Count -eq 0) { throw "No Windows PE files were found under $Path" }
    $result = 'passed'
  } catch {
    $failure = $_.Exception.Message
    throw
  } finally {
    if ($ReportPath) {
      $report = [ordered]@{ result = $result; tool = 'signtool'; error = $failure; files = @($script:Records.ToArray()) }
      $parent = Split-Path ([System.IO.Path]::GetFullPath($ReportPath)) -Parent
      New-Item -ItemType Directory -Force -Path $parent | Out-Null
      Write-JsonUtf8NoBom -Value $report -Path $ReportPath
    }
  }
  Write-Host "Windows signing passed: $($script:Records.Count) PE files under $Path"
}

if ($PSBoundParameters.ContainsKey('Path')) {
  $ErrorActionPreference = 'Stop'
  Invoke-WindowsSigning -Path $Path -ReportPath $ReportPath -OnlyVerify:$VerifyOnly.IsPresent `
    -SignToolPath $SignToolPath -DlibPath $DlibPath -MetadataPath $MetadataPath
}
