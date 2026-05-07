"""
微信联系人 OCR 检测工具
供 AHK 调用的辅助脚本
"""

import sys
import os
import time
import json
import ctypes
from ctypes import wintypes

# 添加 desktop_automation 到路径
sys.path.insert(0, r'I:\web自动化\WebRPA_1.19.5_Green\desktop_automation')

def capture_window_region(hwnd, x, y, width, height):
    """截取窗口指定区域"""
    try:
        from PIL import ImageGrab
        import numpy as np
        
        # 获取窗口位置
        rect = wintypes.RECT()
        ctypes.windll.user32.GetWindowRect(hwnd, ctypes.byref(rect))
        
        # 计算绝对坐标
        abs_x = rect.left + x
        abs_y = rect.top + y
        
        # 截图
        screenshot = ImageGrab.grab(bbox=(
            abs_x, abs_y,
            abs_x + width, abs_y + height
        ))
        
        return screenshot
    except Exception as e:
        print(f"截图失败: {e}")
        return None

def check_wechat_contact():
    """检查微信当前联系人"""
    try:
        from desktop_automation import DesktopAutomation
        from PIL import Image
        import numpy as np
    except ImportError as e:
        return {"is_target": False, "error": f"缺少依赖: {e}"}
    
    try:
        # 查找微信窗口
        user32 = ctypes.windll.user32
        hwnd = user32.FindWindowW(None, "微信")
        
        if not hwnd:
            return {"is_target": False, "error": "未找到微信窗口"}
        
        # 获取窗口尺寸
        rect = wintypes.RECT()
        user32.GetWindowRect(hwnd, ctypes.byref(rect))
        width = rect.right - rect.left
        height = rect.bottom - rect.top
        
        # 截取顶部 100 像素区域
        screenshot = capture_window_region(hwnd, 0, 0, width, 100)
        if not screenshot:
            return {"is_target": False, "error": "截图失败"}
        
        # 保存截图用于调试
        screenshot.save("wechat_top.png")
        
        # 尝试简单的文字识别
        # 这里可以使用多种 OCR 方法
        try:
            # 方法1：尝试使用 easyocr
            import easyocr
            reader = easyocr.Reader(['ch_sim', 'en'])
            results = reader.readtext(np.array(screenshot))
            
            texts = []
            for (bbox, text, prob) in results:
                if prob > 0.5:  # 置信度阈值
                    texts.append(text)
            
            if texts:
                # 查找最可能的联系人名称
                # 通常是最长的非数字文本
                contact_name = None
                for text in texts:
                    if text and not text.isdigit() and len(text) > 1:
                        if contact_name is None or len(text) > len(contact_name):
                            contact_name = text
                
                if contact_name:
                    is_target = "徐科长" in contact_name
                    return {
                        "is_target": is_target,
                        "contact_name": contact_name,
                        "all_texts": texts
                    }
            
        except ImportError:
            # 方法2：尝试使用 rapidocr
            try:
                from rapidocr_onnxruntime import RapidOCR
                ocr = RapidOCR()
                result, _ = ocr(np.array(screenshot))
                
                if result:
                    texts = [item[1] for item in result if item[1]]
                    contact_name = None
                    for text in texts:
                        if text and not text.isdigit() and len(text) > 1:
                            if contact_name is None or len(text) > len(contact_name):
                                contact_name = text
                    
                    if contact_name:
                        is_target = "徐科长" in contact_name
                        return {
                            "is_target": is_target,
                            "contact_name": contact_name,
                            "all_texts": texts
                        }
            except ImportError:
                pass
        
        # 如果 OCR 不可用，返回默认值
        return {"is_target": False, "error": "OCR 不可用"}
        
    except Exception as e:
        return {"is_target": False, "error": str(e)}

def main():
    """主函数"""
    result = check_wechat_contact()
    
    # 输出 JSON 格式结果供 AHK 读取
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
