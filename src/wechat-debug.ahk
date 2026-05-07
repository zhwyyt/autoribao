#NoEnv
#SingleInstance Force
SendMode Input
SetTitleMatchMode, 2
SetWorkingDir, %A_ScriptDir%

FileEncoding, UTF-8

; 调试脚本：尝试获取当前微信聊天对象的名字
; 运行前请先打开微信并进入任意聊天窗口

logPath := A_ScriptDir "\wechat-debug.log"

Log(msg) {
    global logPath
    FormatTime, ts,, yyyy-MM-dd HH:mm:ss
    line := "[" ts "] " msg
    FileAppend, % line "`r`n", %logPath%
    FileAppend, % line "`r`n", *
}

; 激活微信窗口
Log("激活微信窗口")
WinActivate, ahk_exe Weixin.exe
WinWaitActive, ahk_exe Weixin.exe, , 5
if (ErrorLevel) {
    Log("错误：无法激活微信窗口")
    ExitApp, 1
}
Sleep, 1000

; 获取窗口信息
Log("=== 窗口信息 ===")
WinGetTitle, wxTitle, ahk_exe Weixin.exe
Log("窗口标题: " . wxTitle)

WinGetClass, wxClass, ahk_exe Weixin.exe
Log("窗口类: " . wxClass)

WinGet, wxPID, PID, ahk_exe Weixin.exe
Log("进程ID: " . wxPID)

WinGet, wxControls, ControlList, ahk_exe Weixin.exe
Log("控件列表: " . wxControls)

Log("")
Log("=== 尝试获取聊天对象名字 ===")

; 方法1：尝试获取常见控件的文本
controls := "Edit1|Edit2|Static1|Static2|Button1|Button2"
Loop, Parse, controls, |
{
    ctrl := A_LoopField
    ControlGetText, text, %ctrl%, ahk_exe Weixin.exe
    Log("控件 " . ctrl . " 文本: '" . text . "'")
}

Log("")
Log("=== 尝试获取窗口顶部区域文本 ===")
; 获取窗口尺寸和位置
WinGetPos, x, y, w, h, ahk_exe Weixin.exe
Log("窗口位置: " . x . "," . y . " 尺寸: " . w . "x" . h)

; 尝试使用剪贴板获取顶部文本
Log("尝试选择并复制顶部文本")
; 模拟点击顶部区域
Click, % w//2, % y+60
Sleep, 200
Send, ^c
Sleep, 200
Clipboard := ""
Send, ^c
Sleep, 500
clipText := Clipboard
Log("顶部复制文本: '" . clipText . "'")

Log("")
Log("调试完成，请查看日志文件")
MsgBox, 64, 调试完成, 调试信息已保存到 wechat-debug.log`n`n请将日志内容发送给开发者分析。

ExitApp, 0
