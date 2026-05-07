#NoEnv
#SingleInstance Force
SendMode Input
SetTitleMatchMode, 2
SetWorkingDir, %A_ScriptDir%

FileEncoding, UTF-8

; 使用 SendInput 的 {Text} 模式输入中文（不占用剪贴板）
SendChinese(text) {
    ; 先清空当前输入框内容，避免残留字符
    SendInput, ^a
    Sleep, 30
    SendInput, {Backspace}
    Sleep, 30
    ; 使用 {Text} 发送原始文本，避免按键映射导致乱码
    SendInput, {Text}%text%
}

laoma := Chr(0x8001) . Chr(0x5988)

; Args:
; 1: targetName (friend remark or group name)
; 2: filePath (full path)
; 3: message (optional text)
; 4: wechatExe (optional full path to WeChat.exe)
; 5: inputXRatio (optional, window-relative 0..1)
; 6: inputYRatio (optional, window-relative 0..1)

targetName = %1%
filePath = %2%
message = %3%
wechatExe = %4%
inputXRatio = %5%
inputYRatio = %6%

if (targetName = "" || filePath = "") {
    MsgBox, 16, wechat-send, Missing args. Usage: wechat-send.ahk "target" "filePath" ["message"]
    ExitApp, 2
}

if !FileExist(filePath) {
    MsgBox, 16, wechat-send, File not found: %filePath%
    ExitApp, 3
}

logPath := A_ScriptDir "\\wechat-send.log"
stepSleepMs := 2000
afterPasteSleepMs := 2000

Log(msg) {
    global logPath
    FormatTime, ts,, yyyy-MM-dd HH:mm:ss
    line := "[" ts "] " msg
    FileAppend, % line "`r`n", %logPath%
    FileAppend, % line "`r`n", *
}

ShouldDoWarmup(flagPath) {
    ; Warmup only once per batch run: if flag exists and is recent, skip.
    if !FileExist(flagPath)
        return true
    FileGetTime, ts, %flagPath%, M
    if (ts = "")
        return true
    now := A_Now
    EnvSub, now, %ts%, Seconds
    return (now > 300) ; older than 5 minutes -> do warmup again
}

Step(msg) {
    global stepSleepMs
    Log(msg)
    Sleep, %stepSleepMs%
}

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

IsValidRatio(val) {
    if (val = "")
        return false
    if (!RegExMatch(val, "^\s*[+-]?(\d+(\.\d*)?|\.\d+)\s*$"))
        return false
    n := val + 0
    return (n >= 0 && n <= 1)
}

; Put file into clipboard first (avoid relying on Explorer Ctrl+C)
Step("Start: target=" . targetName . " file=" . filePath)
if (!CopyFileToClipboard(filePath)) {
    MsgBox, 16, wechat-send, Failed to copy file to clipboard.
    Log("Clipboard: failed")
    ExitApp, 8
}
Step("Clipboard: file copied")

; Ensure Weixin is running
Process, Exist, Weixin.exe
if (ErrorLevel = 0) {
    Step("Weixin: not running, starting")
    if (wechatExe != "" && FileExist(wechatExe)) {
        Run, %wechatExe%
    } else {
        ; Try common locations
        wx1 := A_ProgramFiles "\\Tencent\\Weixin\\Weixin.exe"
        wx2 := A_ProgramFiles " (x86)\\Tencent\\Weixin\\Weixin.exe"
        wx3 := "C:\\Program Files\\Tencent\\Weixin\\Weixin.exe"
        wx4 := "C:\\Program Files (x86)\\Tencent\\Weixin\\Weixin.exe"
        if (FileExist(wx1))
            Run, %wx1%
        else if (FileExist(wx2))
            Run, %wx2%
        else if (FileExist(wx3))
            Run, %wx3%
        else if (FileExist(wx4))
            Run, %wx4%
        else {
            MsgBox, 16, wechat-send, Weixin.exe not found. Please start WeChat manually or set notify.wechat.wechatExe.
            Log("Weixin: exe not found")
            ExitApp, 5
        }
    }

    WinWait, ahk_exe Weixin.exe, , 10
    Sleep, 2000  ; 等待微信完全启动
}

; Activate Weixin main window
Step("Weixin: activating window")
WinActivate, ahk_exe Weixin.exe
WinWaitActive, ahk_exe Weixin.exe, , 10
if (ErrorLevel) {
    MsgBox, 16, wechat-send, Failed to activate WeChat window.
    Log("Weixin: activate failed")
    ExitApp, 4
}

Sleep, 1000  ; 增加等待时间确保窗口准备就绪

; Warmup: search 老妈 first to reduce occasional mis-positioning after search.
warmupFlag := A_ScriptDir "\\wechat-warmup.flag"
if (targetName != laoma && ShouldDoWarmup(warmupFlag)) {
    Step("UI: warmup Ctrl+F search")
    Send, ^f
    Sleep, 200
    Step("UI: warmup input")
    SendChinese(laoma)
    Sleep, 200
    Step("UI: warmup Enter to open chat")
    Send, {Enter}
    Sleep, 500

    FileDelete, %warmupFlag%
    FileAppend, %A_Now%, %warmupFlag%
}

Step("UI: Ctrl+F search")
Send, ^f
Sleep, 200
Step("UI: input target")
SendChinese(targetName)
Sleep, 200
Step("UI: Enter to open chat")
Send, {Enter}
Sleep, 500

; Paste file into chat
Log("UI: click disabled")
Step("UI: Ctrl+V paste")
Send, ^v
Log("UI: wait after paste ms=" . afterPasteSleepMs)
Sleep, %afterPasteSleepMs%

; Optional message after the file
if (message != "") {
    Step("UI: send file card then type message")
    Send, {Enter}
    Sleep, 200
    SendChinese(message)
    Sleep, 100
}

Step("UI: Enter send")
Send, {Enter}

Log("Done")

ExitApp, 0
