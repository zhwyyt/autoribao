param(
    [string]$TaskName = 'DongwuProductionPlanComponentsSync',
    [int]$HoursStart = 8,
    [int]$HoursEnd = 18,
    [int]$RepeatMinutes = 30
)

$ErrorActionPreference = 'Stop'

Import-Module ScheduledTasks -ErrorAction SilentlyContinue

function Test-IsAdmin {
    $id = [Security.Principal.WindowsIdentity]::GetCurrent()
    $p = New-Object Security.Principal.WindowsPrincipal($id)
    return $p.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

if ($HoursStart -lt 0 -or $HoursStart -gt 23 -or $HoursEnd -lt 0 -or $HoursEnd -gt 23) {
    throw 'HoursStart/HoursEnd must be 0..23'
}
if ($HoursEnd -lt $HoursStart) {
    throw 'HoursEnd must be >= HoursStart'
}
if ($RepeatMinutes -le 0) {
    throw 'RepeatMinutes must be > 0'
}

if (-not (Test-IsAdmin)) {
    $self = $PSCommandPath
    if (-not $self) {
        throw 'Please run this script as Administrator.'
    }

    $argsList = @(
        '-NoProfile',
        '-ExecutionPolicy', 'Bypass',
        '-File', ('"' + $self + '"'),
        '-TaskName', ('"' + $TaskName + '"'),
        '-HoursStart', $HoursStart,
        '-HoursEnd', $HoursEnd,
        '-RepeatMinutes', $RepeatMinutes
    ) -join ' '

    Start-Process -FilePath 'powershell.exe' -Verb RunAs -ArgumentList $argsList -Wait
    exit 0
}

$projectDirFull = $PSScriptRoot
if (-not $projectDirFull) {
    $projectDirFull = Split-Path -Parent $PSCommandPath
}

$cmdPath = Join-Path $projectDirFull 'run_production_plan_components_changed.cmd'

if (-not (Test-Path -LiteralPath $cmdPath)) {
    throw "未找到: $cmdPath"
}

$cmdPathShort = $cmdPath
try {
    Add-Type -Namespace Win32 -Name PathUtil2 -MemberDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class PathUtil2 {
  [DllImport("kernel32.dll", CharSet = CharSet.Auto, SetLastError = true)]
  public static extern uint GetShortPathName(string lpszLongPath, StringBuilder lpszShortPath, uint cchBuffer);
}
'@ -ErrorAction SilentlyContinue

    $sb = New-Object System.Text.StringBuilder 1024
    $r = [Win32.PathUtil2]::GetShortPathName($cmdPath, $sb, $sb.Capacity)
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
$userId = "$env:USERDOMAIN\$env:USERNAME"

$startBoundary = (Get-Date).Date.AddHours($HoursStart)
$duration = New-TimeSpan -Hours ($HoursEnd - $HoursStart)
$durationIso = 'PT{0}H' -f [int]$duration.TotalHours
$intervalIso = 'PT{0}M' -f $RepeatMinutes

$actionArgEsc = $actionArg.Replace('&','&amp;').Replace('<','&lt;').Replace('>','&gt;').Replace('"','&quot;').Replace("'",'&apos;')
$userIdEsc = $userId.Replace('&','&amp;').Replace('<','&lt;').Replace('>','&gt;').Replace('"','&quot;').Replace("'",'&apos;')
$startBoundaryText = $startBoundary.ToString('s')

$xml = @"
<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Date>$startBoundaryText</Date>
    <Author>$userIdEsc</Author>
  </RegistrationInfo>
  <Triggers>
    <CalendarTrigger>
      <StartBoundary>$startBoundaryText</StartBoundary>
      <Enabled>true</Enabled>
      <ScheduleByDay>
        <DaysInterval>1</DaysInterval>
      </ScheduleByDay>
      <Repetition>
        <Interval>$intervalIso</Interval>
        <Duration>$durationIso</Duration>
        <StopAtDurationEnd>false</StopAtDurationEnd>
      </Repetition>
    </CalendarTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author">
      <UserId>$userIdEsc</UserId>
      <LogonType>S4U</LogonType>
      <RunLevel>HighestAvailable</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <StartWhenAvailable>true</StartWhenAvailable>
    <AllowStartOnDemand>true</AllowStartOnDemand>
    <Enabled>true</Enabled>
    <Hidden>false</Hidden>
    <WakeToRun>false</WakeToRun>
    <ExecutionTimeLimit>PT2H</ExecutionTimeLimit>
    <Priority>7</Priority>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>cmd.exe</Command>
      <Arguments>$actionArgEsc</Arguments>
    </Exec>
  </Actions>
</Task>
"@

try {
    if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
        Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    }
} catch {}

Register-ScheduledTask -TaskName $TaskName -Xml $xml | Out-Null

Write-Host ('Task created/updated: ' + $TaskName)
Write-Host ('Schedule: daily from {0:D2}:00 to {1:D2}:00 every {2} minutes' -f $HoursStart, $HoursEnd, $RepeatMinutes)
Write-Host ('Command: ' + $cmdPath)
Write-Host ('RunAs: ' + $userId)
Write-Host ('Test: schtasks /Run /TN "' + $TaskName + '"')
Write-Host 'Verify:'
& schtasks.exe /Query /TN $TaskName
