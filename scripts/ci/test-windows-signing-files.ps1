# Policy tests for windows-signing-files.ps1 with synthetic PE headers; no signing service and no
# certificates are involved, so they run on any host with pwsh.
$ErrorActionPreference = 'Stop'
. "$PSScriptRoot/windows-signing-files.ps1"
$unsignedImplementation = ${function:Invoke-UnsignedFile}
$script:Records = [System.Collections.Generic.List[object]]::new()
$script:SignatureStatus = 'Valid'
function Get-AuthenticodeSignature {
  param([string]$LiteralPath)
  return @{ Status = $script:SignatureStatus; SignerCertificate = @{ Subject = 'CN=Original vendor'; Thumbprint = 'abc' } }
}
function Test-AuthenticodeSignature { param([string]$FilePath) return $script:SignatureStatus -eq 'Valid' }
function Invoke-UnsignedFile { param([string]$FilePath) throw 'Unexpected signing call' }
function Assert-Fails {
  param([scriptblock]$Action, [string]$Expected)
  try { & $Action } catch {
    if ($_.Exception.Message -like "*$Expected*") { return }
    throw "Expected '$Expected', got '$($_.Exception.Message)'"
  }
  throw "Expected failure: $Expected"
}
$root = Join-Path ([System.IO.Path]::GetTempPath()) ('octo-signing-test-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory $root | Out-Null
try {
  $bytes = [byte[]]::new(512)
  $bytes[0] = 0x4d; $bytes[1] = 0x5a; $bytes[60] = 128
  $bytes[128] = 0x50; $bytes[129] = 0x45
  $bytes[132] = 0x64; $bytes[133] = 0x86
  $bytes[152] = 0x0b; $bytes[153] = 0x02
  $file = Join-Path $root 'ffmpeg.dll'
  [System.IO.File]::WriteAllBytes($file, $bytes)
  $original = (Get-FileHash $file).Hash
  Invoke-SignableFile $file 'ffmpeg.dll'
  if ($script:Records[0].action -ne 'preserved' -or (Get-FileHash $file).Hash -ne $original) { throw 'Vendor signature changed.' }
  $native = Join-Path $root 'addon.node'
  [System.IO.File]::WriteAllBytes($native, $bytes)
  Invoke-SignablePath $root
  if (@($script:Records | Where-Object { $_.path -eq 'addon.node' }).Count -ne 1) { throw '.node addons must be covered.' }
  $script:SignatureStatus = 'HashMismatch'
  Assert-Fails { Invoke-SignableFile $file 'ffmpeg.dll' } 'Existing signature is invalid'
  $script:SignatureStatus = 'NotSigned'
  Assert-Fails { Invoke-SignableFile $file 'ffmpeg.dll' -OnlyVerify } 'Unsigned or invalid'
  $script:SignTool = Join-Path $root 'failed-signer.ps1'
  Set-Content $script:SignTool '$global:LASTEXITCODE = 1'
  Assert-Fails { & $unsignedImplementation $file } 'SignTool failed'
  Set-Content $script:SignTool '$global:LASTEXITCODE = 0'
  Assert-Fails { & $unsignedImplementation $file } 'Signature verification failed'
  $bytes[128 + 24 + 112 + 32] = 1
  [System.IO.File]::WriteAllBytes($file, $bytes)
  Assert-Fails { Invoke-SignableFile $file 'ffmpeg.dll' } 'Existing signature is invalid'
  Copy-Item $file "$root/uncovered.bin"
  Assert-Fails { Invoke-SignableFile "$root/uncovered.bin" 'uncovered.bin' } 'Uncovered PE'
  Set-Content $file 'not a library'
  Assert-Fails { Invoke-SignableFile $file 'ffmpeg.dll' } 'not a PE'
  [System.IO.File]::WriteAllBytes($file, [byte[]]@(0x4d, 0x5a))
  Assert-Fails { Get-PeInfo $file } 'Truncated PE'
  $required = @('AZURE_CLIENT_ID', 'AZURE_TENANT_ID', 'AZURE_SUBSCRIPTION_ID', 'AZURE_ARTIFACT_SIGNING_ENDPOINT', 'AZURE_ARTIFACT_SIGNING_ACCOUNT_NAME', 'AZURE_ARTIFACT_SIGNING_CERT_PROFILE_NAME')
  $originalEnv = @{}
  foreach ($name in $required) { $originalEnv[$name] = [Environment]::GetEnvironmentVariable($name); [Environment]::SetEnvironmentVariable($name, $null) }
  try {
    Assert-Fails { & "$PSScriptRoot/assert-windows-signing.ps1" } 'Missing configuration'
    foreach ($name in $required) { [Environment]::SetEnvironmentVariable($name, 'placeholder') }
    [Environment]::SetEnvironmentVariable('AZURE_ARTIFACT_SIGNING_ENDPOINT', 'https://example.com')
    Assert-Fails { & "$PSScriptRoot/assert-windows-signing.ps1" } 'Unexpected Azure Artifact Signing endpoint'
  } finally { foreach ($name in $required) { [Environment]::SetEnvironmentVariable($name, $originalEnv[$name]) } }
  $metadataPath = Join-Path $root 'metadata.json'
  Write-JsonUtf8NoBom -Value ([ordered]@{ Endpoint = 'https://weu.codesigning.azure.net' }) -Path $metadataPath
  $header = [System.IO.File]::ReadAllBytes($metadataPath)[0]
  if ($header -eq 0xEF) { throw 'Signing metadata must not start with a UTF-8 BOM.' }
  if ($header -ne 0x7B) { throw 'Signing metadata must be raw JSON.' }
  $githubEnv = Join-Path $root 'github.env'
  $previousGithubEnv = $env:GITHUB_ENV
  $env:GITHUB_ENV = $githubEnv
  try {
    Add-CiEnvironment -Name 'OCTO_SIGNTOOL_PATH' -Value 'D:\tools\signtool.exe'
    $envBytes = [System.IO.File]::ReadAllBytes($githubEnv)
    if ($envBytes.Length -ge 3 -and $envBytes[0] -eq 0xEF -and $envBytes[1] -eq 0xBB -and $envBytes[2] -eq 0xBF) {
      throw 'GITHUB_ENV lines must not start with a UTF-8 BOM.'
    }
    $envText = [System.IO.File]::ReadAllText($githubEnv, [System.Text.UTF8Encoding]::new($false))
    if ($envText -notmatch '^OCTO_SIGNTOOL_PATH=D:\\tools\\signtool\.exe') { throw 'GITHUB_ENV line was not written correctly.' }
  } finally { $env:GITHUB_ENV = $previousGithubEnv }
  Write-Host 'Windows signing policy tests passed (14 scenarios).'
} finally { Remove-Item -LiteralPath $root -Recurse -Force }
