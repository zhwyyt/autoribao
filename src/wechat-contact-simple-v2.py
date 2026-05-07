"""
简化的微信联系人 OCR 检测
不依赖 desktop_automation 模块
"""

import os
import sys
import json
import time
import ctypes
from ctypes import wintypes

def capture_wechat_window():
    """纯 Python 截取微信窗口顶部区域（用于 OCR）"""
    try:
        try:
            ctypes.windll.shcore.SetProcessDpiAwareness(2)
        except Exception:
            try:
                ctypes.windll.user32.SetProcessDPIAware()
            except Exception:
                pass

        user32 = ctypes.windll.user32

        # 取主窗口句柄（标题通常为“微信”）
        hwnd = user32.FindWindowW(None, "微信")
        if not hwnd:
            return False, "未找到微信窗口(FindWindow: 标题=微信)"

        rect = wintypes.RECT()
        if not user32.GetWindowRect(hwnd, ctypes.byref(rect)):
            return False, "GetWindowRect 调用失败"

        left, top, right, bottom = rect.left, rect.top, rect.right, rect.bottom
        width = right - left
        height = bottom - top
        if width <= 0 or height <= 0:
            return False, f"窗口尺寸异常: {width}x{height}"

        # 截顶部区域（联系人名称一般在标题栏下方）
        cap_left = left
        cap_top = top + 80
        cap_right = right
        cap_bottom = top + 200

        from PIL import ImageGrab

        img = ImageGrab.grab(bbox=(cap_left, cap_top, cap_right, cap_bottom))
        img.save('wechat_top.png')

        if not os.path.exists('wechat_top.png'):
            return False, "截图文件未生成: wechat_top.png"

        return True, f"success width={width} height={height}"

    except Exception as e:
        return False, str(e)

def ocr_with_easyocr():
    """使用 EasyOCR 进行文字识别"""
    try:
        import easyocr
        import numpy as np
        from PIL import Image
        
        if not os.path.exists('wechat_top.png'):
            return {"success": False, "error": "截图文件不存在"}
        
        # 读取图片
        image = Image.open('wechat_top.png')
        
        # OCR 识别
        reader = easyocr.Reader(['ch_sim', 'en'])
        results = reader.readtext(np.array(image))
        
        texts = []
        for (bbox, text, prob) in results:
            if prob > 0.3:  # 置信度阈值
                texts.append(text.strip())
        
        return {
            "success": True,
            "texts": texts,
            "raw_results": results
        }
        
    except ImportError:
        return {"success": False, "error": "easyocr 未安装"}
    except Exception as e:
        return {"success": False, "error": str(e)}

def ocr_with_rapidocr():
    """使用 RapidOCR 进行文字识别（rapidocr-onnxruntime）"""
    try:
        import numpy as np
        from PIL import Image
        from rapidocr_onnxruntime import RapidOCR

        if not os.path.exists('wechat_top.png'):
            return {"success": False, "error": "截图文件不存在"}

        image = Image.open('wechat_top.png')
        img_array = np.array(image)

        ocr = RapidOCR()
        result, _ = ocr(img_array)
        if not result:
            return {"success": True, "texts": [], "raw_results": []}

        texts = []
        for item in result:
            if len(item) < 2:
                continue
            recognized_text = item[1]
            if recognized_text and str(recognized_text).strip():
                texts.append(str(recognized_text).strip())

        return {"success": True, "texts": texts, "raw_results": result}

    except ImportError:
        return {"success": False, "error": "rapidocr-onnxruntime 未安装"}
    except Exception as e:
        return {"success": False, "error": str(e)}

def ocr_with_pytesseract():
    """使用 Tesseract 进行文字识别"""
    try:
        import pytesseract
        from PIL import Image
        
        if not os.path.exists('wechat_top.png'):
            return {"success": False, "error": "截图文件不存在"}
        
        # 读取图片
        image = Image.open('wechat_top.png')
        
        # OCR 识别（中英文）
        text = pytesseract.image_to_string(image, lang='chi_sim+eng')
        
        # 清理文本
        lines = [line.strip() for line in text.split('\n') if line.strip()]
        
        return {
            "success": True,
            "texts": lines,
            "full_text": text
        }
        
    except ImportError:
        return {"success": False, "error": "pytesseract 未安装"}
    except Exception as e:
        return {"success": False, "error": str(e)}

def check_contact_name(texts, target_name="徐科长"):
    """检查是否包含目标联系人名称"""
    if not texts:
        return False, None
    
    # 查找最可能的联系人名称
    contact_name = None
    for text in texts:
        # 跳过太短或纯数字的文本
        if len(text) < 2 or text.isdigit():
            continue
        
        # 如果包含目标名称
        if target_name in text:
            return True, text
        
        # 保存最长的文本作为可能的联系人名
        if contact_name is None or len(text) > len(contact_name):
            contact_name = text
    
    return False, contact_name

def main():
    """主函数"""
    target_name = "徐科长"
    if len(sys.argv) >= 2 and sys.argv[1].strip():
        target_name = sys.argv[1].strip()

    delay_seconds = 0
    if len(sys.argv) >= 3:
        try:
            delay_seconds = int(sys.argv[2])
        except Exception:
            delay_seconds = 0

    print("开始检测微信联系人...")
    print(f"目标联系人: {target_name}")
    if delay_seconds > 0:
        print(f"将在 {delay_seconds} 秒后截图，请切到微信窗口...")
        for i in range(delay_seconds, 0, -1):
            print(f"  {i}...", flush=True)
            time.sleep(1)
    
    # 1. 截取微信窗口
    print("正在截取微信窗口...")
    success, output = capture_wechat_window()
    if not success:
        result = {"is_target": False, "error": f"截图失败: {output}"}
        print(f"截图失败: {output}")
    else:
        print("截图成功")
        
        # 2. OCR 识别
        print("正在进行 OCR 识别...")
        
        # 尝试使用 EasyOCR
        ocr_result = ocr_with_easyocr()
        if not ocr_result["success"]:
            print(f"EasyOCR 失败: {ocr_result['error']}")
            # 尝试使用 RapidOCR
            ocr_result = ocr_with_rapidocr()
            if not ocr_result["success"]:
                print(f"RapidOCR 失败: {ocr_result['error']}")
                # 尝试使用 Tesseract
                ocr_result = ocr_with_pytesseract()
                if not ocr_result["success"]:
                    print(f"Tesseract 失败: {ocr_result['error']}")
                    result = {"is_target": False, "target_name": target_name, "error": "OCR 不可用"}
                else:
                    print("Tesseract 识别成功")
                    texts = ocr_result["texts"]
            else:
                print("RapidOCR 识别成功")
                texts = ocr_result["texts"]
        else:
            print("EasyOCR 识别成功")
            texts = ocr_result["texts"]
        
        if "texts" in locals():
            print(f"识别到的文字: {texts}")
            
            # 3. 检查是否为目标联系人
            is_target, contact_name = check_contact_name(texts, target_name=target_name)
            
            result = {
                "is_target": is_target,
                "target_name": target_name,
                "contact_name": contact_name,
                "all_texts": texts,
                "success": True
            }
            
            if is_target:
                print(f"✓ 找到目标联系人: {contact_name}")
            else:
                print(f"✗ 当前联系人: {contact_name} (不是目标)")
    
    # 输出 JSON 结果
    print("\n检测结果:")
    print(json.dumps(result, ensure_ascii=False, indent=2))
    
    # 保存到文件
    with open("wechat_contact_result.json", "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)
    
    # 返回退出码
    sys.exit(0 if result.get("is_target") else 1)

if __name__ == "__main__":
    main()
