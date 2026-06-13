# ZO注册项目 — 长期记忆

## 项目概述
ZO平台 (zo.computer) 云端计算机注册自动化项目。通过Playwright浏览器自动化完成注册、Turnstile突破、保活部署全流程。

## 环境信息
- 工作目录: `E:\API获取工具\ZO注册`
- Node.js运行环境
- Chrome路径: `C:\Users\XZXyuan\AppData\Local\Google\Chrome\Application\chrome.exe`
- Edge路径: `C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`
- 邮箱文件目录: `E:\API获取工具\批量注册邮箱\已经使用\7\`

## 邮箱文件格式
每行格式: `email----password----clientId----refreshToken`

## Turnstile突破方案
- 使用持久化Profile (`chromium.launchPersistentContext`) 
- Turnstile Patcher Chrome扩展 (`keepalive/turnstile-patch/`)
- CDP深度DOM遍历定位Widget坐标
- 自然人鼠标轨迹模拟点击
- 核心难点：Cloudflare后端JavaScript挑战判定自动化环境，token可能永远不生成

## 已有成功注册
- hilljulia5es7y81c6u8a@outlook.com → user7fuda2 (完全成功)
- bushuozaijian2026@outlook.com → useryhwmwu (部分)
- kebukeyi2026@outlook.com → user4k9m2p (部分)
- sanchezquinncu3w1kkhtuc74@outlook.com → builderpcux

## 关键脚本
- `zo_full_deploy.mjs` — 全自动注册+SSH+保活部署（最新，2026-06-13）
- `zo_monitor.mjs` — 本地存活监控脚本（2026-06-13）
- `check_and_fix.mjs` — 检查+修复+部署脚本（已验证可行）
- `crack_turnstile_v9.mjs` — Turnstile破解v9
- `browser-auto-register.mjs` — 早期浏览器注册脚本
- `keepalive/keepalive.js` — 本地保活脚本（需本地浏览器CDP连接）
- `keepalive/start.bat` — 本地保活启动器

## 保活架构
- ZO服务器内部: keepalive-server.js (HTTP面板3456, 15分钟自保)
- 本地监控: zo_monitor.mjs (DNS→TCP→HTTP三层检测)

## 连接信息输出
- `zo_connection.json` — 注册后自动生成的连接信息
