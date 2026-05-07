param(
    [string]$TaskName = 'DongwuProjectListSync',
    [string[]]$At = @('16:30')
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

    $atArg = ($At | ForEach-Object { '"' + $_ + '"' }) -join ','
    $argsList = @(
        '-NoProfile',
        '-ExecutionPolicy', 'Bypass',
        '-File', ('"' + $self + '"'),
        '-TaskName', ('"' + $TaskName + '"'),
        '-At', $atArg
    ) -join ' '

    Start-Process -FilePath 'powershell.exe' -Verb RunAs -ArgumentList $argsList -Wait
    exit 0
}

$projectDirFull = $PSScriptRoot
if (-not $projectDirFull) {
    $projectDirFull = Split-Path -Parent $PSCommandPath
}

$cmdPath = Join-Path $projectDirFull 'run_project_list.cmd'

if (-not (Test-Path -LiteralPath $cmdPath)) {
    throw "未找到: $cmdPath"
}

# cmd.exe 对中文路径不稳定：尽量使用 8.3 短路径
$cmdPathShort = $cmdPath
try {
    Add-Type -Namespace Win32 -Name PathUtil -MemberDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class PathUtil {
  [DllImport("kernel32.dll", CharSet = CharSet.Auto, SetLastError = true)]
  public static extern uint GetShortPathName(string lpszLongPath, StringBuilder lpszShortPath, uint cchBuffer);
}
'@ -ErrorAction SilentlyContinue

    $sb = New-Object System.Text.StringBuilder 1024
    $r = [Win32.PathUtil]::GetShortPathName($cmdPath, $sb, $sb.Capacity)
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

# Action: cmd.exe /c "<cmdPath>"
$actionArg = '/c ""' + $cmdPathShort + '""'
$action = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument $actionArg

# Triggers: daily at each time
$triggers = @()
foreach ($t in $At) {
    $atTime = Get-Date $t
    $triggers += New-ScheduledTaskTrigger -Daily -At $atTime
}

# Run as current user without password (S4U)
$userId = "$env:USERDOMAIN\$env:USERNAME"
$principal = New-ScheduledTaskPrincipal -UserId $userId -LogonType S4U -RunLevel Highest

$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Hours 2)

$task = New-ScheduledTask -Action $action -Trigger $triggers -Principal $principal -Settings $settings

# Replace if exists
try {
    if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
        Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    }
} catch {}

Register-ScheduledTask -TaskName $TaskName -InputObject $task | Out-Null

Write-Host ('Task created/updated: ' + $TaskName)
Write-Host ('Schedule: daily at ' + ($At -join ', '))
Write-Host ('Command: ' + $cmdPath)
Write-Host ('RunAs: ' + $userId)
Write-Host ('Test: schtasks /Run /TN "' + $TaskName + '"')
Write-Host 'Verify:'
& schtasks.exe /Query /TN $TaskName

