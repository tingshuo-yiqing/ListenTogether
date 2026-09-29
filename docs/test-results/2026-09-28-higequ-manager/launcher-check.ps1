# Isolated launcher checks: replace process/browser calls; never start a real service.
param([ValidateSet('reuse','start','missing','old')][string]$Mode = 'reuse')
$ErrorActionPreference = 'Stop'
$script:Requests = 0
function Invoke-RestMethod {
  param($Uri,$TimeoutSec)
  $script:Requests++
  if (($Mode -eq 'reuse' -or $Mode -eq 'old') -or ($Mode -eq 'start' -and $script:Requests -gt 1)) {
    return @{ serviceVersion = $(if ($Mode -eq 'old') {'old'} else {'20260929-lyrics-preview'}); sources = @(@{name='higequ'}) }
  }
  throw 'fixture: no manager'
}
function Test-Path {
  param($LiteralPath)
  return $Mode -ne 'missing'
}
function Start-Sleep { param($Milliseconds) }
function Start-Process {
  param($FilePath,$ArgumentList,$WorkingDirectory,$WindowStyle,$RedirectStandardOutput,$RedirectStandardError,[switch]$PassThru)
  if ($FilePath -like 'http://*') { Write-Host "PASS $Mode browser handoff"; return }
  if ($WindowStyle -ne 'Hidden') { throw 'service must be hidden' }
  if ($ArgumentList -ne 'scripts/metadata-manager.mjs') { throw 'unexpected service arguments' }
  if (!(Microsoft.PowerShell.Management\Test-Path -LiteralPath (Join-Path $WorkingDirectory 'scripts/metadata-manager.mjs'))) { throw 'wrong working directory' }
  Write-Host 'PASS start hidden process and project directory'
  $proc = [pscustomobject]@{ HasExited = $false }
  $proc | Add-Member -MemberType ScriptMethod -Name Refresh -Value {}
  return $proc
}
function Read-Host { param($Prompt) Write-Host "PASS $Mode gives actionable error without starting service" }
$root = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../..'))
& (Join-Path $root 'scripts/start-metadata.ps1')
exit $LASTEXITCODE
