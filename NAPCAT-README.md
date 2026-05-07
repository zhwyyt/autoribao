# NapCat QQ机器人使用说明

## 🎯 为什么选择NapCat？

**解决了下午能用、现在不能用的问题！**
- **注入式架构**：直接Hook你的QQ客户端，不是第三方协议
- **永不封号**：使用的是官方QQ客户端
- **无需扫码**：直接使用已登录的QQ
- **超稳定**：和WebRPA项目使用相同技术

## 🚀 快速启动（当前推荐方案）

> 说明：旧版 `NapCat\launcher.bat` 启动方式已经弃用，当前只使用 **NapCatOneKey** 这一套。

### 1. 启动 NapCatOneKey（必须先执行）

**方式一：PowerShell（推荐）**

```powershell
# 以管理员身份打开 PowerShell，进入 bootmain 目录后执行：
cd I:\autoweb\autoribao\NapCatOneKey\bootmain
.\napcat.quick.ps1   # 快速登录（默认：列表第 2 个账号，可用 -Index 指定）

# 或手动扫码登录：
.\napcat.ps1
```

若提示无法执行脚本，先执行：`Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser`

**方式二：批处理**

```bash
# 方案 A：先用 QQ 自带“自动登录”，NapCat 只负责注入（推荐，减少扫码风控）
#   1）先用 QQ 正常登录并勾选“自动登录、下次登录无需在手机端确认”
#   2）以后只需要启动 NapCat 注入即可：
I:\autoweb\autoribao\NapCatOneKey\bootmain\napcat.bat

# 方案 B：使用 NapCat 快速登录（部分账号可能被 QQ 风控强制扫码）
#   默认：列表第 2 个账号；也可以传入序号参数
I:\autoweb\autoribao\NapCatOneKey\bootmain\napcat.quick.bat

# 如果想运行完停住窗口（仅手工调试用）：
I:\autoweb\autoribao\NapCatOneKey\bootmain\napcat.quick.bat 2 --pause
```

### 2. 启动 QQ 机器人

```bash
node src/qq-bot-napcat.js
```

也可以直接双击运行：
- `I:\autoweb\autoribao\start-qq-bot-napcat.bat`

### 3. （可选）配置开机自启动（方案B：任务计划程序）

```powershell
cd I:\autoweb\autoribao
.\setup-autostart.ps1 -Install   # 安装开机自启（NapCat + QQ机器人）

# 如需取消开机自启：
.\setup-autostart.ps1 -Uninstall
```

说明：
- 脚本会创建两个计划任务（仅当前用户）：
  - `NapCat_QuickLogin`：登录后立即运行 `NapCatOneKey\bootmain\napcat.quick.bat`
  - `QQBot_NapCat`：登录约 20 秒后运行 `start-qq-bot-napcat.bat`
- 需要以 **管理员身份** 运行 PowerShell 执行上述命令。
- 如果你使用的是 Windows PowerShell 5.1，建议直接使用本文档提供的命令运行（脚本已避免中文输出，减少编码问题）。

## 📱 使用方法

1. **确保QQ已登录**
2. **启动NapCat**（会自动注入到QQ）
3. **启动机器人程序**
4. **用手机QQ给机器人发消息**

### 可用指令：
- `测试` - 测试机器人连接
- `日报` - 生成当日日报
- `收发存` - 生成收发存报表
- `帮助` - 查看帮助信息

## 🔧 NapCat配置

NapCat会在 `http://127.0.0.1:3000` 提供OneBot API服务

### Web管理界面
- 访问：`http://127.0.0.1:3000`
- 可以查看状态、配置参数等

## 🛠️ 故障排除

### 1. NapCat启动失败
- 确保以管理员身份运行
- 确保QQ已安装并登录
- 检查防火墙设置

### 2. 机器人连接失败
- 确保NapCat已启动
- 检查端口3000是否被占用
- 重启NapCat和机器人

### 3. 消息发送失败
- 检查QQ是否正常登录
- 确认QQ号配置正确
- 查看NapCat日志

## 📋 文件结构

```text
I:\autoweb\autoribao\
├── NapCatOneKey\                                   # 当前使用的 NapCat 一键版（推荐）
│   └── NapCat.44498.Shell\versions\9.9.26-44498\
│       └── resources\app\napcat\                  # NapCat 主程序与配置
├── NapCat\                                        # 旧版 NapCat（已弃用，可按需备份/删除）
├── src\
│   └── qq-bot-napcat.js                           # 机器人程序（NapCat OneBot 版）
└── config\
    └── qq-bot.json                                # QQ 机器人配置（QQ 号、授权用户等）
```

## 🎉 优势对比

| 特性 | NapCat方案 | 传统oicq方案 |
|------|------------|--------------|
| 稳定性 | ⭐⭐⭐⭐⭐ | ⭐⭐ |
| 封号风险 | 无 | 中等 |
| 登录方式 | 无需扫码 | 扫码登录 |
| 兼容性 | 最佳 | 一般 |
| 配置复杂度 | 简单 | 复杂 |

## 📞 技术支持

如果遇到问题：
1. 检查NapCat是否正常启动
2. 确认QQ登录状态
3. 查看控制台日志
4. 重启所有程序

---

**NapCat是目前最稳定的QQ机器人方案，强烈推荐使用！**
