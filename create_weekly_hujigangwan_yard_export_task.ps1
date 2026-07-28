param(
    [string]$TaskName = 'DongwuHujigangwanWeeklyYardExport',
    [string]$At = '13:00'
)

$ErrorActionPreference = 'Stop'

function Test-IsAdmin {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

if (-not (Test-IsAdmin)) {
    Start-Process powershell.exe -Verb RunAs -Wait -ArgumentList @(
        '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ('"' + $PSCommandPath + '"'),
        '-TaskName', ('"' + $TaskName + '"'), '-At', ('"' + $At + '"')
    )
    exit $LASTEXITCODE
}

$cmdPath = Join-Path $PSScriptRoot 'run_weekly_hujigangwan_yard_export.cmd'
if (-not (Test-Path -LiteralPath $cmdPath)) { throw "未找到: $cmdPath" }
$userId = "$env:USERDOMAIN\$env:USERNAME"
$startBoundary = (Get-Date).Date.Add((Get-Date $At).TimeOfDay).ToString('s')
$arguments = '/c ""' + $cmdPath + '""'

$xml = @"
<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo><Date>$startBoundary</Date><Author>$userId</Author></RegistrationInfo>
  <Triggers><CalendarTrigger><StartBoundary>$startBoundary</StartBoundary><Enabled>true</Enabled><ScheduleByWeek><WeeksInterval>1</WeeksInterval><DaysOfWeek><Friday /></DaysOfWeek></ScheduleByWeek></CalendarTrigger></Triggers>
  <Principals><Principal id="Author"><UserId>$userId</UserId><LogonType>S4U</LogonType><RunLevel>HighestAvailable</RunLevel></Principal></Principals>
  <Settings><MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy><DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries><StopIfGoingOnBatteries>false</StopIfGoingOnBatteries><StartWhenAvailable>true</StartWhenAvailable><AllowStartOnDemand>true</AllowStartOnDemand><Enabled>true</Enabled><ExecutionTimeLimit>PT4H</ExecutionTimeLimit></Settings>
  <Actions Context="Author"><Exec><Command>cmd.exe</Command><Arguments>$arguments</Arguments></Exec></Actions>
</Task>
"@

if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) { Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false }
Register-ScheduledTask -TaskName $TaskName -Xml $xml | Out-Null
Write-Host "Task created/updated: $TaskName"
Write-Host 'Schedule: every Friday at 13:00'
& schtasks.exe /Query /TN $TaskName /FO LIST
