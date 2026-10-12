# Fails fast when the Windows release signing configuration is incomplete. The secrets come from
# the GitHub environment `windows-release`; nothing here prints their values.
$ErrorActionPreference = 'Stop'
$required = @('AZURE_CLIENT_ID', 'AZURE_TENANT_ID', 'AZURE_SUBSCRIPTION_ID',
  'AZURE_ARTIFACT_SIGNING_ENDPOINT', 'AZURE_ARTIFACT_SIGNING_ACCOUNT_NAME', 'AZURE_ARTIFACT_SIGNING_CERT_PROFILE_NAME')
$missing = @($required | Where-Object { [string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable($_)) })
if ($missing.Count) { throw "Windows release signing is enabled but incomplete. Missing configuration: $($missing -join ', ')" }
if ($env:AZURE_ARTIFACT_SIGNING_ENDPOINT -notmatch '^https://[a-z0-9]+\.codesigning\.azure\.net/?$') {
  throw 'Unexpected Azure Artifact Signing endpoint.'
}
Write-Host 'Windows signing configuration is present; Azure authentication and the real signature are checked next.'
