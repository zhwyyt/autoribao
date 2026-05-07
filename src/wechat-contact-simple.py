"""
简化的微信联系人检测脚本
使用 Windows 内置的 PowerShell OCR 功能
"""

import os
import sys
import json
import subprocess
import tempfile
import time

def capture_wechat_top():
    """使用 PowerShell 截取微信窗口顶部"""
    try:
        # PowerShell 脚本
        ps_script = '''
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

# 查找微信窗口
$wechat = Get-Process | Where-Object { $_.ProcessName -eq "Weixin" } | Select-Object -First 1
if (-not $wechat) {
    Write-Output '{"error": "微信未运行"}'
    exit 1
}

# 获取窗口句柄和位置
$handle = $wechat.MainWindowHandle
$rect = New-Object System.Drawing.Rectangle
[System.Drawing.Graphics]::CopyFromScreen(
    [System.Drawing.Point]::Empty,
    [System.Drawing.Point]::Empty,
    [System.Drawing.Screen]::PrimaryScreen.Bounds.Size
)

# 获取窗口位置
import-module C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe -Function Get-WindowRect
$pos = [PSCustomObject]@{
    Left = 0
    Top = 0
    Right = 800
    Bottom = 600
}

# 截取顶部区域
$bitmap = New-Object System.Drawing.Bitmap(800, 100)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.CopyFromScreen($pos.Left, $pos.Top + 80, 0, 0, $bitmap.Size)

# 保存截图
$bitmap.Save("wechat_top.png", [System.Drawing.Imaging.ImageFormat]::Png)
$graphics.Dispose()
$bitmap.Dispose()

Write-Output '{"success": true}'
'''
        
        # 保存到临时文件
        with tempfile.NamedTemporaryFile(mode='w', suffix='.ps1', delete=False) as f:
            f.write(ps_script)
            ps_file = f.name
        
        try:
            # 执行 PowerShell 脚本
            result = subprocess.run(
                ['powershell', '-ExecutionPolicy', 'Bypass', '-File', ps_file],
                capture_output=True,
                text=True,
                encoding='utf-8'
            )
            
            if result.returncode == 0 and 'success' in result.stdout:
                return True, None
            else:
                return False, result.stderr or result.stdout
        finally:
            # 清理临时文件
            try:
                os.unlink(ps_file)
            except:
                pass
                # 清理临时文件
            try:
                os.unlink(ps_file)
            except:
                pass
                
    except Exception as e:
        return False, str(e)

def simple_ocr_check():
    """简单的 OCR 检查"""
    # 如果有 easyocr
    try:
        import easyocr
        import numpy as np
        from PIL import Image
        
        if not os.path.exists('wechat_top.png'):
            return False, "截图文件不存在"
        
        # 读取图片
        image = Image.open('wechat_top.png')
        
        # OCR 识别
        reader = easyocr.Reader(['ch_sim', 'en'])
        results = reader.readtext(np.array(image))
        
        texts = []
        for (bbox, text, prob) in results:
            if prob > 0.3:  # 降低置信度阈值
                texts.append(text)
        
        # 检查是否包含目标联系人
        target_found = any('徐科长' in text for text in texts)
        
        return {
            "is_target": target_found,
            "texts": texts,
            "success": True
        }
        
    except ImportError:
        return {"is_target": False, "error": "easyocr 未安装", "success": False}
    except Exception as e:
        return {"is_target": False, "error": str(e), "success": False}

def main():
    """主函数"""
    # 截图
    success, error = capture_wechat_top()
    if not success:
        result = {"is_target": False, "error": f"截图失败: {error}", "success": False}
    else:
        # OCR 识别
        result = simple_ocr_check()
    
    # 输出结果
    print(json.dumps(result, ensure_ascii=False))
    
    # 保存到文件
    with open("wechat_contact_result.json", "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)
    
    # 返回退出码
    if result.get("is_target"):
        sys.exit(0)
    else:
        sys.exit(1)

if __name__ == "__main__":
    main()
