#NoEnv
#SingleInstance Force
SendMode Input
SetTitleMatchMode, 2
SetWorkingDir, %A_ScriptDir%

FileEncoding, UTF-8

; 简单测试脚本
FileAppend, 测试开始`r`n, test.log
FileAppend, 时间: %A_Now%`r`n, test.log

; 激活微信窗口
WinActivate, ahk_exe Weixin.exe
WinWaitActive, ahk_exe Weixin.exe, , 5
if (ErrorLevel) {
    FileAppend, 无法激活微信窗口`r`n, test.log
    ExitApp, 1
}

; 获取窗口标题
WinGetTitle, wxTitle, ahk_exe Weixin.exe
FileAppend, 窗口标题: %wxTitle%`r`n, test.log

; 获取控件列表
WinGet, wxControls, ControlList, ahk_exe Weixin.exe
FileAppend, 控件列表: %wxControls%`r`n, test.log

; 尝试获取一些控件的文本
ControlGetText, text1, Edit1, ahk_exe Weixin.exe
FileAppend, Edit1文本: %text1%`r`n, test.log

ControlGetText, text2, Static1, ahk_exe Weixin.exe
FileAppend, Static1文本: %text2%`r`n, test.log

FileAppend, 测试结束`r`n, test.log
MsgBox, 测试完成
ExitApp, 0
