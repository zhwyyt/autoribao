param(
    [string]$TaskName = 'DongwuDailyOrderSync',
    [string]$At = '03:30'
)

$ErrorActionPreference = 'Stop'

Import-Module ScheduledTasks -ErrorAction SilentlyContinue

function Test-IsAdmin {
    $id = [Security.Principal.WindowsIdentity]::GetCurrent()
    $p = New-Object Security.Principal.WindowsPrincipal($id)
    return $p.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

if (-not (Test-IsAdmin)) {
    $self = $PSCommandPath
    if (-not $self) {
        throw 'Please run this script as Administrator.'
    }

    $argsList = '-NoProfile -ExecutionPolicy Bypass -File "' + $self + '" -TaskName "' + $TaskName + '" -At "' + $At + '"'
    Start-Process -FilePath 'powershell.exe' -Verb RunAs -ArgumentList $argsList -Wait
    exit 0
}

$projectDirFull = $PSScriptRoot
if (-not $projectDirFull) {
    $projectDirFull = Split-Path -Parent $PSCommandPath
}

$cmdPath = Join-Path $projectDirFull 'run_daily_order_sync.cmd'

if (-not (Test-Path -LiteralPath $cmdPath)) {
    throw "未找到: $cmdPath"
}

$cmdPathShort = $cmdPath
try {
    Add-Type -Namespace Win32 -Name PathUtilOrderSync -MemberDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class PathUtilOrderSync {
  [DllImport("kernel32.dll", CharSet = CharSet.Auto, SetLastError = true)]
  public static extern uint GetShortPathName(string lpszLongPath, StringBuilder lpszShortPath, uint cchBuffer);
}
'@ -ErrorAction SilentlyContinue

    $sb = New-Object System.Text.StringBuilder 1024
    $r = [Win32.PathUtilOrderSync]::GetShortPathName($cmdPath, $sb, $sb.Capacity)
    if ($r -gt 0) {
        $short = $sb.ToString()
        if ($short) { $cmdPathShort = $short }
    }
} catch {
    $cmdPathShort = $cmdPath
}

$logsDir = Join-Path $projectDirFull 'logs'
if (-not (Test-Path -LiteralPath $logsDir)) {
    New-Item -ItemType Directory -Force -Path $logsDir | Out-Null
}

$actionArg = '/c ""' + $cmdPathShort + '""'
$action = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument $actionArg

$atTime = Get-Date $At
$trigger = New-ScheduledTaskTrigger -Daily -At $atTime

$userId = "$env:USERDOMAIN\$env:USERNAME"
$principal = New-ScheduledTaskPrincipal -UserId $userId -LogonType S4U -RunLevel Highest

$settings = New-ScheduledTaskSettingsSet `
    -StartWhenAvailable `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -MultipleInstances IgnoreNew `
    -ExecutionTimeLimit (New-TimeSpan -Hours 3)

$task = New-ScheduledTask -Action $action -Trigger $trigger -Principal $principal -Settings $settings

try {
    if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
        Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    }
} catch {}

Register-ScheduledTask -TaskName $TaskName -InputObject $task | Out-Null

Write-Host ('Task created/updated: ' + $TaskName)
Write-Host ('Schedule: daily at ' + $At)
Write-Host ('Command: ' + $cmdPath)
Write-Host ('RunAs: ' + $userId)
Write-Host ('Test: schtasks /Run /TN "' + $TaskName + '"')
