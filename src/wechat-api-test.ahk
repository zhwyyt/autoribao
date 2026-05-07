#NoEnv
#SingleInstance Force
SendMode Input
SetTitleMatchMode, 2
SetWorkingDir, %A_ScriptDir%

FileEncoding, UTF-8

; 使用 Windows API 获取窗口信息
Log(msg) {
    FileAppend, %msg%`r`n, *
}

Log("开始测试...")

; 激活微信窗口
WinActivate, ahk_exe Weixin.exe
WinWaitActive, ahk_exe Weixin.exe, , 5
if (ErrorLevel) {
    Log("无法激活微信窗口")
    ExitApp, 1
}

; 获取窗口句柄
WinGet, hWnd, ID, ahk_exe Weixin.exe
Log("窗口句柄: " . hWnd)

; 获取窗口标题
WinGetTitle, wxTitle, ahk_exe Weixin.exe
Log("窗口标题: " . wxTitle)

; 尝试获取父窗口（可能有聊天信息）
WinGet, parentHwnd, ID, ahk_exe Weixin.exe
Loop, 5
{
    ; 获取父窗口
    parentHwnd := DllCall("GetParent", "UInt", parentHwnd)
    if (parentHwnd = 0)
        break
    
    WinGetTitle, parentTitle, ahk_id %parentHwnd%
    Log("父窗口标题: " . parentTitle)
}

; 尝试枚举子窗口
Log("尝试枚举子窗口...")
EnumChildProc(hwnd, lParam) {
    static count := 0
    count++
    
    WinGetTitle, childTitle, ahk_id %hwnd%
    WinGetClass, childClass, ahk_id %hwnd%
    
    if (childTitle != "" && childTitle != "微信" && childTitle != "WeChat") {
        Log("子窗口 " . count . " 标题: " . childTitle . " 类: " . childClass)
    }
    
    return true  ; 继续枚举
}

; 注册回调函数并枚举子窗口
DllCall("EnumChildWindows", "UInt", hWnd, "Ptr", RegisterCallback("EnumChildProc"), "UInt", 0)

Log("测试完成")
MsgBox, 测试完成
ExitApp, 0
