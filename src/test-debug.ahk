#NoEnv
#SingleInstance Force
SendMode Input
SetTitleMatchMode, 2
SetWorkingDir, %A_ScriptDir%

FileEncoding, UTF-8

targetName = %1%
filePath = %2%

FileAppend, 开始执行`r`n, test-debug.log
FileAppend, 目标: %targetName%`r`n, test-debug.log
FileAppend, 文件: %filePath%`r`n, test-debug.log

; 检查文件是否存在
if !FileExist(filePath) {
    FileAppend, 错误：文件不存在`r`n, test-debug.log
    ExitApp, 3
}
FileAppend, 文件存在`r`n, test-debug.log

; 复制文件到剪贴板
if (!CopyFileToClipboard(filePath)) {
    FileAppend, 错误：复制文件到剪贴板失败`r`n, test-debug.log
    ExitApp, 8
}
FileAppend, 文件已复制到剪贴板`r`n, test-debug.log

; 激活微信
WinActivate, ahk_exe Weixin.exe
WinWaitActive, ahk_exe Weixin.exe, , 5
if (ErrorLevel) {
    FileAppend, 错误：无法激活微信`r`n, test-debug.log
    ExitApp, 4
}
FileAppend, 微信已激活`r`n, test-debug.log

FileAppend, 测试完成`r`n, test-debug.log
MsgBox, 测试完成
ExitApp, 0

CopyFileToClipboard(file) {
    file := StrReplace(file, "/", "\\")

    ; DROPFILES struct (20 bytes) + UTF-16 path (double-null terminated)
    bytes := (StrLen(file) + 2) * 2
    hMem := DllCall("GlobalAlloc", "UInt", 0x42, "UPtr", 20 + bytes, "UPtr")
    if (!hMem)
        return false

    pMem := DllCall("GlobalLock", "UPtr", hMem, "UPtr")
    if (!pMem) {
        DllCall("GlobalFree", "UPtr", hMem)
        return false
    }

    ; pFiles offset = 20, fWide = 1 (UTF-16)
    NumPut(20, pMem + 0, "UInt")
    NumPut(1, pMem + 16, "UInt")
    StrPut(file, pMem + 20, "UTF-16")
    DllCall("GlobalUnlock", "UPtr", hMem)

    if (!DllCall("OpenClipboard", "UPtr", 0)) {
        DllCall("GlobalFree", "UPtr", hMem)
        return false
    }

    DllCall("EmptyClipboard")
    if (!DllCall("SetClipboardData", "UInt", 15, "UPtr", hMem)) {
        DllCall("CloseClipboard")
        DllCall("GlobalFree", "UPtr", hMem)
        return false
    }
    DllCall("CloseClipboard")
    return true
}
