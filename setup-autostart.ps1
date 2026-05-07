#requires -RunAsAdministrator
<#
Install/uninstall Windows Scheduled Tasks to autostart:
  - NapCatOneKey quick login (napcat.quick.bat)
  - QQ bot (start-qq-bot-napcat.bat) with delay

Usage (run PowerShell as Administrator):
  cd I:\autoweb\autoribao
  .\setup-autostart.ps1 -Install

Uninstall:
  .\setup-autostart.ps1 -Uninstall
#>

[CmdletBinding()]
param(
  [switch]$Install,
  [switch]$Uninstall,
  [int]$BotDelaySeconds = 20
)

$ErrorActionPreference = 'Stop'

if (-not ($Install -xor $Uninstall)) {
  Write-Host "Usage:" -ForegroundColor Yellow
  Write-Host "  Install:   .\setup-autostart.ps1 -Install" -ForegroundColor Yellow
  Write-Host "  Uninstall: .\setup-autostart.ps1 -Uninstall" -ForegroundColor Yellow
  exit 1
}

Import-Module ScheduledTasks -ErrorAction Stop

$projectRoot = 'I:\autoweb\autoribao'
$napcatBat   = Join-Path $projectRoot 'NapCatOneKey\bootmain\napcat.quick.bat'
$qqBotBat    = Join-Path $projectRoot 'start-qq-bot-napcat.bat'

$taskNapcat  = 'NapCat_QuickLogin'
$taskQqBot   = 'QQBot_NapCat'

function Remove-TaskIfExists([string]$name) {
  $t = Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue
  if ($null -ne $t) {
    Unregister-ScheduledTask -TaskName $name -Confirm:$false
    Write-Host ("Removed scheduled task: " + $name) -ForegroundColor Green
  } else {
    Write-Host ("Scheduled task not found: " + $name) -ForegroundColor DarkGray
  }
}

if ($Uninstall) {
  foreach ($n in @($taskNapcat, $taskQqBot)) {
    try { Remove-TaskIfExists $n } catch { Write-Warning ("Failed removing " + $n + ": " + $_.Exception.Message) }
  }
  Write-Host "Done." -ForegroundColor Green
  exit 0
}

foreach ($p in @($napcatBat, $qqBotBat)) {
  if (-not (Test-Path $p)) {
    throw ("File not found: " + $p)
  }
}

if ($BotDelaySeconds -lt 0) { throw "BotDelaySeconds must be >= 0" }
$delay = [TimeSpan]::FromSeconds($BotDelaySeconds)
$delayIso = 'PT' + [int]$delay.TotalSeconds + 'S'

$currentUser = "$env:USERDOMAIN\$env:USERNAME"

try {
  # 1) NapCat task (run at logon, highest privileges)
  $action1    = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument ('/c ""' + $napcatBat + '""') -WorkingDirectory (Split-Path -Parent $napcatBat)
  $trigger1   = New-ScheduledTaskTrigger -AtLogon
  $principal1 = New-ScheduledTaskPrincipal -UserId $currentUser -RunLevel Highest
  Register-ScheduledTask -TaskName $taskNapcat -Action $action1 -Trigger $trigger1 -Principal $principal1 -Force | Out-Null
  Write-Host ("Created scheduled task: " + $taskNapcat) -ForegroundColor Green

  # 2) QQ bot task (run at logon with delay, highest privileges)
  $action2    = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument ('/c ""' + $qqBotBat + '""') -WorkingDirectory (Split-Path -Parent $qqBotBat)
  $trigger2   = New-ScheduledTaskTrigger -AtLogon
  $trigger2.Delay = $delayIso
  $principal2 = New-ScheduledTaskPrincipal -UserId $currentUser -RunLevel Highest
  Register-ScheduledTask -TaskName $taskQqBot -Action $action2 -Trigger $trigger2 -Principal $principal2 -Force | Out-Null
  Write-Host ("Created scheduled task: " + $taskQqBot + " (delay " + $BotDelaySeconds + "s)") -ForegroundColor Green

  Write-Host ""
  Write-Host "Autostart configured successfully." -ForegroundColor Green
  Write-Host ("You can adjust in Task Scheduler Library: " + $taskNapcat + " / " + $taskQqBot) -ForegroundColor Green
} catch {
  Write-Error ("Failed creating scheduled tasks: " + $_.Exception.Message)
  exit 1
}

