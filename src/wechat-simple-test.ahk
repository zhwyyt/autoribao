#NoEnv
#SingleInstance Force
SendMode Input
SetTitleMatchMode, 2
SetWorkingDir, %A_ScriptDir%

FileEncoding, UTF-8

; 激活微信窗口
WinActivate, ahk_exe Weixin.exe
WinWaitActive, ahk_exe Weixin.exe, , 5
if (ErrorLevel) {
    FileAppend, 无法激活微信窗口`r`n, *
    ExitApp, 1
}

; 获取窗口位置
WinGetPos, x, y, w, h, ahk_exe Weixin.exe
FileAppend, 窗口位置: %x%, %y% 尺寸: %w%x%h%`r`n, *

; 方法1：尝试点击顶部区域并复制
FileAppend, 方法1：点击顶部中央`r`n, *
Click, % w//2, % y+80
Sleep, 300
Send, ^c
Sleep, 300
clipText := Clipboard
FileAppend, 剪贴板文本: '%clipText%'`r`n, *

; 方法2：尝试双击选择
FileAppend, 方法2：双击顶部区域`r`n, *
Click, 2, % w//2, % y+80
Sleep, 300
Send, ^c
Sleep, 300
clipText := Clipboard
FileAppend, 双击后剪贴板文本: '%clipText%'`r`n, *

MsgBox, 测试完成
ExitApp, 0
