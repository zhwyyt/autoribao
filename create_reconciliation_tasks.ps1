param(
    [string]$ProcessDailyTaskName = 'DongwuNightlyProcessReconciliation',
    [string]$ProcessNoonTaskName = 'DongwuNoonProcessReconciliation',
    [string]$ProcessMonthlyTaskName = 'DongwuMonthlyProcessReconciliation',
    [string]$ShippingDailyTaskName = 'DongwuNightlyShippingAlignment',
    [string]$ShippingNoonTaskName = 'DongwuNoonShippingAlignment',
    [string]$ShippingMonthlyTaskName = 'DongwuMonthlyShippingAlignment',
    [string]$ProcessDailyAt = '00:00',
    [string]$ProcessNoonAt = '12:00',
    [string]$ShippingDailyAt = '02:00',
    [string]$ShippingNoonAt = '12:30',
    [int]$MonthlyDayOfMonth = 26
)

$ErrorActionPreference = 'Stop'
Import-Module ScheduledTasks -ErrorAction SilentlyContinue

function Test-IsAdmin {
    $id = [Security.Principal.WindowsIdentity]::GetCurrent()
    $p = New-Object Security.Principal.WindowsPrincipal($id)
    return $p.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Get-ShortPath([string]$PathValue) {
    $result = $PathValue
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
        $r = [Win32.PathUtil]::GetShortPathName($PathValue, $sb, $sb.Capacity)
        if ($r -gt 0 -and $sb.ToString()) {
            $result = $sb.ToString()
        }
    } catch {}
    return $result
}

function Register-DailyTask([string]$TaskName, [string]$CmdPath, [string]$At) {
    $cmdShort = Get-ShortPath $CmdPath
    $actionArg = '/c ""' + $cmdShort + '""'
    $action = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument $actionArg
    $trigger = New-ScheduledTaskTrigger -Daily -At (Get-Date $At)
    $userId = "$env:USERDOMAIN\$env:USERNAME"
    $principal = New-ScheduledTaskPrincipal -UserId $userId -LogonType S4U -RunLevel Highest
    $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Hours 4)
    $task = New-ScheduledTask -Action $action -Trigger $trigger -Principal $principal -Settings $settings
    try {
        if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
            Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
        }
    } catch {}
    Register-ScheduledTask -TaskName $TaskName -InputObject $task | Out-Null
}

function Register-MonthlyTask([string]$TaskName, [string]$CmdPath, [string]$At, [int]$DayOfMonth) {
    $cmdShort = Get-ShortPath $CmdPath
    $actionArg = '/c ""' + $cmdShort + '""'
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
}

if (-not (Test-IsAdmin)) {
    $self = $PSCommandPath
    $argsList = @(
        '-NoProfile',
        '-ExecutionPolicy', 'Bypass',
        '-File', ('"' + $self + '"'),
        '-ProcessDailyTaskName', ('"' + $ProcessDailyTaskName + '"'),
        '-ProcessNoonTaskName', ('"' + $ProcessNoonTaskName + '"'),
        '-ProcessMonthlyTaskName', ('"' + $ProcessMonthlyTaskName + '"'),
        '-ShippingDailyTaskName', ('"' + $ShippingDailyTaskName + '"'),
        '-ShippingNoonTaskName', ('"' + $ShippingNoonTaskName + '"'),
        '-ShippingMonthlyTaskName', ('"' + $ShippingMonthlyTaskName + '"'),
        '-ProcessDailyAt', ('"' + $ProcessDailyAt + '"'),
        '-ProcessNoonAt', ('"' + $ProcessNoonAt + '"'),
        '-ShippingDailyAt', ('"' + $ShippingDailyAt + '"'),
        '-ShippingNoonAt', ('"' + $ShippingNoonAt + '"'),
        '-MonthlyDayOfMonth', $MonthlyDayOfMonth
    ) -join ' '
    Start-Process -FilePath 'powershell.exe' -Verb RunAs -ArgumentList $argsList -Wait
    exit 0
}

$projectDir = $PSScriptRoot
$processDailyCmd = Join-Path $projectDir 'run_nightly_process_reconciliation.cmd'
$processMonthlyCmd = Join-Path $projectDir 'run_monthly_process_reconciliation.cmd'
$shippingDailyCmd = Join-Path $projectDir 'run_nightly_shipping_alignment.cmd'
$shippingMonthlyCmd = Join-Path $projectDir 'run_monthly_shipping_alignment.cmd'

foreach ($cmd in @($processDailyCmd, $processMonthlyCmd, $shippingDailyCmd, $shippingMonthlyCmd)) {
    if (-not (Test-Path -LiteralPath $cmd)) {
        throw "未找到: $cmd"
    }
}

Register-DailyTask -TaskName $ProcessDailyTaskName -CmdPath $processDailyCmd -At $ProcessDailyAt
Register-DailyTask -TaskName $ProcessNoonTaskName -CmdPath $processDailyCmd -At $ProcessNoonAt
Register-MonthlyTask -TaskName $ProcessMonthlyTaskName -CmdPath $processMonthlyCmd -At $ProcessDailyAt -DayOfMonth $MonthlyDayOfMonth
Register-DailyTask -TaskName $ShippingDailyTaskName -CmdPath $shippingDailyCmd -At $ShippingDailyAt
Register-DailyTask -TaskName $ShippingNoonTaskName -CmdPath $shippingDailyCmd -At $ShippingNoonAt
Register-MonthlyTask -TaskName $ShippingMonthlyTaskName -CmdPath $shippingMonthlyCmd -At $ShippingDailyAt -DayOfMonth $MonthlyDayOfMonth

Write-Host "Tasks created/updated:"
Write-Host "- $ProcessDailyTaskName daily at $ProcessDailyAt"
Write-Host "- $ProcessNoonTaskName daily at $ProcessNoonAt"
Write-Host "- $ProcessMonthlyTaskName monthly day $MonthlyDayOfMonth at $ProcessDailyAt"
Write-Host "- $ShippingDailyTaskName daily at $ShippingDailyAt"
Write-Host "- $ShippingNoonTaskName daily at $ShippingNoonAt"
Write-Host "- $ShippingMonthlyTaskName monthly day $MonthlyDayOfMonth at $ShippingDailyAt"
