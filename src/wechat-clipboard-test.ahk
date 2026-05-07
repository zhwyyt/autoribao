#NoEnv
#SingleInstance Force
SendMode Input
SetTitleMatchMode, 2
SetWorkingDir, %A_ScriptDir%

FileEncoding, UTF-8

; 尝试通过剪贴板获取聊天对象名字
logPath := A_ScriptDir "\wechat-debug.log"

Log(msg) {
    global logPath
    FormatTime, ts,, yyyy-MM-dd HH:mm:ss
    line := "[" ts "] " msg
    FileAppend, % line "`r`n", %logPath%
}

Log("开始测试")

; 激活微信窗口
WinActivate, ahk_exe Weixin.exe
WinWaitActive, ahk_exe Weixin.exe, , 5
if (ErrorLevel) {
    Log("无法激活微信窗口")
    ExitApp, 1
}

; 获取窗口位置
WinGetPos, x, y, w, h, ahk_exe Weixin.exe
Log("窗口位置: " . x . ", " . y . " 尺寸: " . w . "x" . h)

; 方法1：尝试点击顶部区域并复制
Log("方法1：点击顶部中央")
Click, % w//2, % y+80
Sleep, 300
Send, ^c
Sleep, 300
clipText := ClipboardAll
Log("剪贴板数据长度: " . StrLen(clipText))

; 方法2：尝试双击选择
Log("方法2：双击顶部区域")
Click, 2, % w//2, % y+80
Sleep, 300
Send, ^c
Sleep, 300
clipText := Clipboard
Log("双击后剪贴板文本: '" . clipText . "'")

; 方法3：尝试使用 Alt+D 选择地址栏（某些应用有效）
Log("方法3：尝试 Alt+D")
Send, !d
Sleep, 300
Send, ^c
Sleep, 300
clipText := Clipboard
Log("Alt+D 后剪贴板文本: '" . clipText . "'")

; 方法4：尝试 F2 重命名（可能选中标题）
Log("方法4：尝试 F2")
Send, {F2}
Sleep, 300
Send, ^c
Sleep, 300
clipText := Clipboard
Log("F2 后剪贴板文本: '" . clipText . "'")

Log("测试完成")
MsgBox, 测试完成，请查看日志
ExitApp, 0
