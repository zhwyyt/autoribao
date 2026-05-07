"""
使用 OCR 识别微信对话框中的联系人名称
"""

import sys
import os
import time
import json

# 添加 desktop_automation 到路径
sys.path.insert(0, r'I:\web自动化\WebRPA_1.19.5_Green\desktop_automation')

def check_wechat_contact(target_name="徐科长"):
    """
    检查微信当前对话框是否是目标联系人
    
    Args:
        target_name: 目标联系人名称
    
    Returns:
        dict: {"is_target": bool, "current_name": str or None}
    """
    try:
        from desktop_automation import DesktopAutomation
        from PIL import ImageGrab
        import numpy as np
    except ImportError as e:
        print(f"错误：缺少依赖 {e}")
        print("请确保已安装 desktop_automation 模块")
        return {"is_target": False, "current_name": None, "error": str(e)}
    
    # 创建自动化对象
    auto = DesktopAutomation()
    
    # 激活微信窗口
    print("激活微信窗口...")
    auto.window.activate("Weixin.exe")
    time.sleep(1)
    
    # 获取微信窗口位置
    try:
        # 获取窗口句柄
        import ctypes
        user32 = ctypes.windll.user32
        
        # 查找微信窗口
        hwnd = user32.FindWindowW(None, "微信")
        if not hwnd:
            # 尝试使用类名
            hwnd = user32.FindWindowW("WeMainWindow", None)
        
        if not hwnd:
            print("未找到微信窗口")
            return {"is_target": False, "current_name": None, "error": "未找到微信窗口"}
        
        # 获取窗口位置
        rect = ctypes.wintypes.RECT()
        user32.GetWindowRect(hwnd, ctypes.byref(rect))
        
        x, y = rect.left, rect.top
        width = rect.right - rect.left
        height = rect.bottom - rect.top
        
        print(f"微信窗口位置: ({x}, {y}, {width}, {height})")
        
        # 定义联系人名称区域（通常在窗口顶部）
        # 假设联系人名称在顶部 80-120 像素区域
        name_region = {
            "x": x + 50,  # 左边留一些空间
            "y": y + 80,  # 顶部区域
            "width": width - 100,  # 右边留一些空间
            "height": 40  # 高度
        }
        
        print(f"搜索区域: {name_region}")
        
        # 截取联系人名称区域
        screenshot = ImageGrab.grab(bbox=(
            name_region["x"], 
            name_region["y"],
            name_region["x"] + name_region["width"],
            name_region["y"] + name_region["height"]
        ))
        
        # 保存截图用于调试
        debug_path = "wechat_name_region.png"
        screenshot.save(debug_path)
        print(f"已保存区域截图到: {debug_path}")
        
        # 使用 OCR 识别文字
        try:
            from rapidocr_onnxruntime import RapidOCR
            ocr = RapidOCR()
            
            # 转换为 numpy 数组
            img_array = np.array(screenshot)
            
            # OCR 识别
            result, _ = ocr(img_array)
            
            if result:
                print("识别到的文字:")
                current_name = None
                
                for item in result:
                    box, recognized_text, confidence = item
                    if recognized_text and recognized_text.strip():
                        print(f"  - {recognized_text} (置信度: {confidence:.2f})")
                        # 通常联系人名称是最长的文字
                        if current_name is None or len(recognized_text) > len(current_name):
                            current_name = recognized_text.strip()
                
                if current_name:
                    is_target = target_name in current_name or current_name in target_name
                    print(f"\n当前联系人: {current_name}")
                    print(f"是否为目标: {is_target}")
                    
                    return {
                        "is_target": is_target,
                        "current_name": current_name,
                        "all_texts": [item[1] for item in result if item[1]]
                    }
                else:
                    print("未识别到有效文字")
                    return {"is_target": False, "current_name": None}
            else:
                print("OCR 未识别到任何文字")
                return {"is_target": False, "current_name": None}
                
        except ImportError:
            print("错误：需要安装 rapidocr-onnxruntime")
            print("运行: pip install rapidocr-onnxruntime")
            return {"is_target": False, "current_name": None, "error": "缺少 OCR 库"}
            
    except Exception as e:
        print(f"错误：{e}")
        import traceback
        traceback.print_exc()
        return {"is_target": False, "current_name": None, "error": str(e)}

def main():
    """主函数"""
    print("=" * 60)
    print("  微信联系人 OCR 识别")
    print("=" * 60)
    print()
    
    # 检查命令行参数
    target_name = "徐科长"
    if len(sys.argv) > 1:
        target_name = sys.argv[1]
    
    print(f"目标联系人: {target_name}")
    print()
    print("请确保：")
    print("1. 微信已打开")
    print("2. 当前在某个聊天对话框中")
    print()
    input("准备好后按回车开始检测...")
    print()
    
    # 执行检测
    result = check_wechat_contact(target_name)
    
    print()
    print("=" * 60)
    print("检测结果:")
    print(f"  当前联系人: {result.get('current_name', '未识别')}")
    print(f"  是否为目标: {'是' if result.get('is_target') else '否'}")
    
    if result.get("error"):
        print(f"  错误信息: {result['error']}")
    
    if result.get("all_texts"):
        print(f"  所有识别文字: {result['all_texts']}")
    
    print("=" * 60)
    
    # 保存结果到 JSON 文件
    with open("wechat_contact_check.json", "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)
    print("\n结果已保存到: wechat_contact_check.json")

if __name__ == "__main__":
    main()
