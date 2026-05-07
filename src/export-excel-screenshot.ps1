param(
    [Parameter(Mandatory=$true)][string]$InputXlsx,
    [Parameter(Mandatory=$true)][string]$OutputPng,
    [string]$SheetName = ''
)

$ErrorActionPreference = 'Stop'

function Release-ComObject($obj) {
    try {
        if ($null -ne $obj) {
            [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($obj)
        }
    } catch {}
}

if (-not (Test-Path -LiteralPath $InputXlsx)) {
    throw "InputXlsx not found: $InputXlsx"
}

$excel = $null
$wb = $null
$ws = $null
$chartObj = $null
$chart = $null

try {
    $excelType = [Type]::GetTypeFromProgID('Excel.Application')
    if (-not $excelType) {
        throw 'Excel ProgID not found: Excel.Application'
    }

    # Late-binding avoids interop/type library issues on some machines (e.g. 0x80029C4A)
    $excel = [Activator]::CreateInstance($excelType)
    $excel.Visible = $false
    $excel.DisplayAlerts = $false

    $wb = $excel.Workbooks.Open($InputXlsx)

    if ([string]::IsNullOrWhiteSpace($SheetName)) {
        $ws = $wb.Worksheets.Item(1)
    } else {
        $ws = $wb.Worksheets.Item($SheetName)
    }

    $used = $ws.UsedRange
    if (-not $used) {
        throw 'UsedRange is empty'
    }

    # Improve readability: fit on page (for image export). We still export range exactly.
    try {
        $ws.PageSetup.Zoom = $false
        $ws.PageSetup.FitToPagesWide = 1
        $ws.PageSetup.FitToPagesTall = 1
    } catch {}

    $used.CopyPicture(1, 2) | Out-Null  # 1=xlScreen, 2=xlPicture

    $left = $used.Left
    $top = $used.Top
    $width = $used.Width
    $height = $used.Height

    # Create a chart as a container for the picture, then export.
    $chartObj = $ws.ChartObjects().Add($left, $top, $width, $height)
    $chart = $chartObj.Chart
    $chart.Paste() | Out-Null

    $outDir = Split-Path -Parent $OutputPng
    if (-not (Test-Path -LiteralPath $outDir)) {
        New-Item -ItemType Directory -Force -Path $outDir | Out-Null
    }

    # Ensure extension
    if (-not $OutputPng.ToLower().EndsWith('.png')) {
        $OutputPng = $OutputPng + '.png'
    }

    $chart.Export($OutputPng, 'PNG') | Out-Null
}
finally {
    try {
        if ($chartObj) { $chartObj.Delete() | Out-Null }
    } catch {}

    try {
        if ($wb) { $wb.Close($false) | Out-Null }
    } catch {}

    try {
        if ($excel) { $excel.Quit() | Out-Null }
    } catch {}

    Release-ComObject $chart
    Release-ComObject $chartObj
    Release-ComObject $ws
    Release-ComObject $wb
    Release-ComObject $excel

    [GC]::Collect()
    [GC]::WaitForPendingFinalizers()
}
