param(
    [string]$Database = 'dwyunsc',
    [string]$HostName = 'localhost',
    [int]$Port = 5432,
    [string]$User = 'postgres'
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$configPath = Join-Path $projectRoot 'config\default.json'
if (-not (Test-Path $configPath)) {
    throw "Missing config: $configPath"
}

$config = Get-Content $configPath -Raw | ConvertFrom-Json
if ($config.db.host) { $HostName = $config.db.host }
if ($config.db.port) { $Port = [int]$config.db.port }
if ($config.db.user) { $User = $config.db.user }
if ($config.db.database) { $Database = $config.db.database }
$password = $config.db.password

$backupDir = Join-Path $projectRoot 'backups'
if (-not (Test-Path $backupDir)) {
    New-Item -ItemType Directory -Path $backupDir | Out-Null
}

$stamp = Get-Date -Format 'yyyyMMdd_HHmmss'
$backupFile = Join-Path $backupDir "dwyunsc_before_order_sync_$stamp.dump"

$pgDumpCandidates = @(
    'pg_dump',
    'C:\Program Files\PostgreSQL\17\bin\pg_dump.exe',
    'C:\Program Files\PostgreSQL\16\bin\pg_dump.exe',
    'C:\Program Files\PostgreSQL\15\bin\pg_dump.exe',
    'C:\Program Files\PostgreSQL\14\bin\pg_dump.exe'
)

$pgDump = $null
foreach ($candidate in $pgDumpCandidates) {
    if ($candidate -eq 'pg_dump') {
        $cmd = Get-Command pg_dump -ErrorAction SilentlyContinue
        if ($cmd) {
            $pgDump = $cmd.Source
            break
        }
    } elseif (Test-Path $candidate) {
        $pgDump = $candidate
        break
    }
}

if (-not $pgDump) {
    throw 'pg_dump not found. Install PostgreSQL client tools or add pg_dump to PATH.'
}

$env:PGPASSWORD = $password
& $pgDump -h $HostName -p $Port -U $User -d $Database -F c -f $backupFile
Remove-Item Env:\PGPASSWORD -ErrorAction SilentlyContinue

if (-not (Test-Path $backupFile)) {
    throw "Backup failed: $backupFile"
}

$sizeMb = [Math]::Round((Get-Item $backupFile).Length / 1MB, 2)
Write-Output "Backup OK: $backupFile ($sizeMb MB)"
