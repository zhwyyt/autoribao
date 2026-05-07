param(
    [string]$TaskName = 'DongwuShoufacunReport',
    [string]$At = '22:00',
    [int]$DayOfMonth = 25
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

    $argsList = @(
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        ('"' + $self + '"'),
        '-TaskName',
        ('"' + $TaskName + '"'),
        '-At',
        ('"' + $At + '"'),
        '-DayOfMonth',
        $DayOfMonth
    ) -join ' '
    Start-Process -FilePath 'powershell.exe' -Verb RunAs -ArgumentList $argsList -Wait
    exit 0
}

$projectDirFull = $PSScriptRoot
if (-not $projectDirFull) {
    $projectDirFull = Split-Path -Parent $PSCommandPath
}

$cmdPath = Join-Path $projectDirFull 'run_shoufacun_report.cmd'

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

# Run as current user via S4U (no password) to match interactive environment.
$userId = "$env:USERDOMAIN\$env:USERNAME"
$startBoundary = (Get-Date).Date.Add((Get-Date $At).TimeOfDay).ToString('s')

$actionArgEsc = $actionArg.Replace('&','&amp;').Replace('<','&lt;').Replace('>','&gt;').Replace('"','&quot;').Replace("'",'&apos;')
$userIdEsc = $userId.Replace('&','&amp;').Replace('<','&lt;').Replace('>','&gt;').Replace('"','&quot;').Replace("'",'&apos;')

$xml = @"
<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Date>$startBoundary</Date>
    <Author>$userIdEsc</Author>
  </RegistrationInfo>
  <Triggers>
    <CalendarTrigger>
      <StartBoundary>$startBoundary</StartBoundary>
      <Enabled>true</Enabled>
      <ScheduleByMonth>
        <DaysOfMonth>
          <Day>$DayOfMonth</Day>
        </DaysOfMonth>
        <Months>
          <January />
          <February />
          <March />
          <April />
          <May />
          <June />
          <July />
          <August />
          <September />
          <October />
          <November />
          <December />
        </Months>
      </ScheduleByMonth>
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
    <ExecutionTimeLimit>PT4H</ExecutionTimeLimit>
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

Write-Host "Task created/updated: $TaskName"
Write-Host "Schedule: monthly day $DayOfMonth at $At"
Write-Host "Command: $cmdPath"
Write-Host "RunAs: $userId (S4U)"
Write-Host "Test: schtasks /Run /TN \"$TaskName\""
Write-Host "Verify:"
& schtasks.exe /Query /TN $TaskName
