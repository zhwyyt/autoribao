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

targetsRaw = %1%
filePath = %2%
message = %3%
wechatExe = %4%
inputXRatio = %5%
inputYRatio = %6%

if (targetsRaw = "" || filePath = "") {
    MsgBox, 16, wechat-send-batch, Missing args. Usage: wechat-send-batch.ahk "t1|t2" "filePath" ["message"]
    ExitApp, 2
}

if !FileExist(filePath) {
    MsgBox, 16, wechat-send-batch, File not found: %filePath%
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

Step(msg) {
    global stepSleepMs
    Log(msg)
    Sleep, %stepSleepMs%
}

Log("Env: A_IsUnicode=" . A_IsUnicode . " A_AhkVersion=" . A_AhkVersion)
Log("Args: targetsRaw=" . targetsRaw)

CopyFileToClipboard(file) {
    file := StrReplace(file, "/", "\\")

    bytes := (StrLen(file) + 2) * 2
    hMem := DllCall("GlobalAlloc", "UInt", 0x42, "UPtr", 20 + bytes, "UPtr")
    if (!hMem)
        return false

    pMem := DllCall("GlobalLock", "UPtr", hMem, "UPtr")
    if (!pMem) {
        DllCall("GlobalFree", "UPtr", hMem)
        return false
    }

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

WarmupToLaoma() {
    global laoma
    Step("UI: warmup Ctrl+F search")
    Send, ^f
    Sleep, 200
    Step("UI: warmup input")
    SendChinese(laoma)
    Sleep, 200
    Step("UI: warmup Enter to open chat")
    Send, {Enter}
    Sleep, 500
}

SendToTarget(targetName, filePath, message) {
    global afterPasteSleepMs

    Step("UI: Ctrl+F search")
    Send, ^f
    Sleep, 200
    Step("UI: input target")
    SendChinese(targetName)
    Sleep, 200
    Step("UI: Enter to open chat")
    Send, {Enter}
    Sleep, 500

    if (!CopyFileToClipboard(filePath)) {
        Log("Clipboard: failed")
        return 8
    }

    Log("UI: click disabled")
    Step("UI: Ctrl+V paste")
    Send, ^v
    Log("UI: wait after paste ms=" . afterPasteSleepMs)
    Sleep, %afterPasteSleepMs%

    if (message != "") {
        Step("UI: send file card then type message")
        Send, {Enter}
        Sleep, 200
        SendChinese(message)
        Sleep, 100
    }

    Step("UI: Enter send")
    Send, {Enter}
    return 0
}

; Ensure Weixin is running
Process, Exist, Weixin.exe
if (ErrorLevel = 0) {
    Step("Weixin: not running, starting")
    if (wechatExe != "" && FileExist(wechatExe)) {
        Run, %wechatExe%
    } else {
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
            MsgBox, 16, wechat-send-batch, Weixin.exe not found.
            Log("Weixin: exe not found")
            ExitApp, 5
        }
    }

    WinWait, ahk_exe Weixin.exe, , 10
    Sleep, 2000
}

Step("Weixin: activating window")
WinActivate, ahk_exe Weixin.exe
WinWaitActive, ahk_exe Weixin.exe, , 10
if (ErrorLevel) {
    MsgBox, 16, wechat-send-batch, Failed to activate WeChat window.
    Log("Weixin: activate failed")
    ExitApp, 4
}

Sleep, 1000

targetsRaw := Trim(targetsRaw)
arr := StrSplit(targetsRaw, "|")

if (arr.Length() = 0) {
    MsgBox, 16, wechat-send-batch, No targets.
    ExitApp, 2
}

Log("BatchStart: targets=" . targetsRaw . " file=" . filePath)

; Warmup once if there exists any non-老妈 target.
doWarmup := false
for idx, t in arr {
    t := Trim(t)
    if (t != "" && t != laoma) {
        doWarmup := true
        break
    }
}
if (doWarmup) {
    WarmupToLaoma()
}

for idx, t in arr {
    t := Trim(t)
    if (t = "")
        continue

    Log("BatchTargetStart: " . t)
    rc := SendToTarget(t, filePath, message)
    Log("BatchTargetEnd: " . t . " rc=" . rc)
    if (rc != 0) {
        ExitApp, rc
    }
}

Log("BatchDone")
ExitApp, 0
