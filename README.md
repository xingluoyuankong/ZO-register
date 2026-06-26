# ZO Computer 批量凭证获取工具 — Turnstile 破解完整方案

> **当前版本：V1.0 (2026-06-27)**
> 
> 自动化绕过 Cloudflare Turnstile 人机验证，批量获取 ZO Computer 账号的 Access Token + Cookie AT 双凭证。
>
> GitHub: `https://github.com/xingluoyuankong/ZO-register.git`

---

## 📦 核心文件清单（仅保留跑通版本）

```
ZO注册/
├── plugin/                          # 🔴 核心运行目录
│   ├── batch_at.js                  # 批量 AT 获取主脚本（支持 4 并发，30s fast-fail）
│   ├── zo_register.js               # 核心库：浏览器启停、邮箱轮询、AT 提取
│   ├── smart_fetch.js               # 智能凭证获取器（按状态跳过已完成步骤）
│   ├── server.js                    # Web UI（Express + WebSocket）
│   ├── config.json                  # 运行配置
│   └── start.bat                    # 一键启动
├── turnstile-extension/             # 🔴 Cloudflare Turnstile 绕过扩展 V4
│   ├── manifest.json                # MV3 清单：all_frames + world=MAIN + document_start
│   └── script.js                    # 10 层反检测补丁（核心）
├── extension/                       # 备用 Chrome 扩展注册方案（系统B）
├── registered/                      # 🔴 凭证输出目录
│   ├── Access Tokens/               # zo_sk AT 文件（每个账号一个 txt）
│   └── Cookie ATs/                  # Cookie AT 文件（每个账号一个 txt）
├── archive/                         # ⚠️ 仅备份，不用于运行
├── _历史版本/                        # ⚠️ 旧版本备份
├── _整理后备份/                       # ⚠️ 整理前备份
├── test/                            # ⚠️ 诊断/验证脚本
├── keepalive-scripts/               # 辅助脚本
├── node_modules/                    # npm 依赖
├── key/                             # 密钥
├── public/                          # Web UI 静态文件
├── README.md                        # 本文档
├── GUIDE.md                         # 使用指南
├── config.json                      # 全局配置
├── package.json                     # 项目配置
├── start.bat                        # 启动脚本
└── .gitignore                       # Git 忽略规则
```

---

## 🔑 Turnstile 人机验证 — 完整破解原理

### 检测机制（逆向分析）

Cloudflare Turnstile 通过以下多层向量判定是否为机器人：

| 检测层 | 检测内容 | 判定标准 |
|--------|---------|---------|
| L1 - MouseEvent | `screenX` vs `clientX` | `screenX === clientX` → 100% 机器人（正常用户有窗口偏移）|
| L2 - PointerEvent | 同 MouseEvent 逻辑 | 同上 |
| L3 - navigator.webdriver | `navigator.webdriver` 属性 | `true` → 自动化工具 |
| L4 - navigator.userAgentData | UA brands/mobile/platform | 不匹配真实浏览器 → bot |
| L5 - canvas 指纹 | `toDataURL` 哈希一致性 | 相同 → bot（bot 的 canvas 指纹不波动）|
| L6 - WebGL 指纹 | `RENDERER`/`VENDOR` 字符串 | 与浏览器 claim 不匹配 → bot |
| L7 - plugins | `navigator.plugins` 长度 | 0 → headless 浏览器 |
| L8 - chrome.runtime | `chrome` 对象 | 缺失 → headless（非 Chrome）|
| L9 - cdc_ 属性 | `cdc_adoQpoasnfa76pfcZLmcfl_*` | 存在 → Puppeteer/Playwright 痕迹 |
| L10 - Shadow DOM | Turnstile widget 内 iframe | 通过 Shadow DOM 检测注入痕迹 |

### 破解方案 V4：Chrome MV3 扩展

**为什么不能用 `evaluateOnNewDocument`？**
- CDP 的 `evaluateOnNewDocument` 只在主 frame 注入
- Turnstile 的 checkbox 和 challenge 都运行在 Shadow DOM 内的 iframe 中
- 主 frame 的补丁**根本进不去** iframe，Turnstile 仍检测到 `screenX === clientX`
- 只有 Chrome 扩展的 `"all_frames": true` + `"world": "MAIN"` 配置能穿透到所有 iframe

**V4 扩展架构：**

```json
// manifest.json
{
  "manifest_version": 3,
  "content_scripts": [{
    "js": ["./script.js"],
    "matches": ["<all_urls>"],
    "run_at": "document_start",   // ← 在页面任何 JS 之前注入
    "all_frames": true,            // ← 注入到所有 iframe（关键！）
    "world": "MAIN"                // ← 运行在主 JS 环境（非 isolated）
  }]
}
```

**10 层反检测补丁（script.js）：**

```
L1:  MouseEvent.screenX = clientX + random(80~480) + jitter(±2)
     MouseEvent.screenY = clientY + random(60~260) + jitter(±2)
     → 每帧独立随机偏移量，避免模式检测
     
L2:  PointerEvent.screenX/screenY（Turnstile 也检测 PointerEvent）

L3:  window.outerWidth/Height 伪装（仅顶层窗口）
     → outerWidth = innerWidth + 16（chrome 窗口 chrome）

L4:  navigator.webdriver = undefined（基础）
     Navigator.prototype.webdriver = false（双重覆盖）

L5:  navigator.userAgentData → Chrome 131/Win/x86_64 伪装
     → 包括 brands、mobile、platform、getHighEntropyValues

L6:  navigator.plugins → 3 个真实插件 + PluginArray.prototype
     → item/namedItem/refresh/Symbol.iterator 全模拟

L7:  chrome.runtime → 完整 connect/sendMessage 补全

L8:  Canvas toDataURL → 最低位随机翻转（每次略有不同）

L9:  WebGL UNMASKED_VENDOR → 'Intel Inc.'
     UNMASKED_RENDERER → 'Intel Iris OpenGL Engine'

L10: cdc_ 开头的全局属性→ 逐一删除
     attachShadow → 记录 closed Shadow DOM 引用
     permissions.query → 拦截 notifications 查询
```

**V4 关键修复（vs V3）：**
- ⭐ **移除了 CF iframe 守卫**：V3 在 iframe 内跳过 screenX/Y 补丁（只修复 webdriver），这是**致命缺陷** — Turnstile 100% 判定为机器人
- **增加 userAgentData 补丁**：来自 grok-register-main 成熟方案，2026 年 CF 头号检测向量
- **Canvas/WebGL 噪声**：进一步降低指纹一致性

---

## 🔄 完整流程

### 凭证获取流程 (batch_at.js)

```
读取 zo.txt（223 账号，格式：邮箱----密码----clientId----refreshToken）
    ↓
检查已有 AT（zo_sk + Cookie AT），跳过已完成账号
    ↓
并发启动 ≤4 个浏览器（信号量控制 MAX_BROWSERS=4）
    ↓
对每个账号：
    ├─ Step 1: 打开 https://www.zo.computer/signup
    ├─ Step 2: 点击 "Email me a sign-up link"
    ├─ Step 3: 填写 Outlook 邮箱，提交
    ├─ Step 4: Microsoft Graph API 轮询收件箱 → 提取 magic link
    ├─ Step 5: 打开 magic link → Turnstile 扩展自动破解
    │    ├─ ⚡ 快速路径：直接跳转到 workspace（已注册）
    │    ├─ 🐌 慢速路径：等 verify 页自跳转（10-20s）
    │    └─ ❌ 死路径：30s 无 cookie → fast-fail
    ├─ 检测 handle（URL 子域或 "Go to your Zo" 链接）
    ├─ 导航到 handle.zo.computer/_boot → 检测空间状态
    ├─ Dormant 状态 → 等待唤醒（ZO Space boot）
    ├─ 进入活跃 workspace → 等待 chat 准备就绪
    └─ 提取凭证：
         ├─ Cookie AT：从浏览器 cookies 读取 access_token
         └─ zo_sk AT：导航到 Settings → Advanced → 创建 API Key
```

### 两种注册系统

| | 系统A (Puppeteer) | 系统B (Chrome Extension) |
|---|---|---|
| **入口** | `plugin/zo_register.js` | `extension/` |
| **引擎** | Puppeteer-core 25.x + Edge | Chrome MV3 扩展 |
| **Turnstile** | 加载 turnstile-extension/ | 内置 patch 脚本 |
| **用途** | 批量 AT 获取 | 手动/自动化注册 |
| **状态** | ✅ V1.0 跑通 | 备用（扩展方案） |

---

## 🕳️ 踩过的每一个坑 — 详细记录

### 坑 1：CF iframe 守卫导致的致命缺陷（⏱️ 00:24-00:27）

**现象**：Turnstile 扩展 V3 加载后，验证仍然 100% 失败。
**根因**：V3 的 script.js 中有这段代码：
```javascript
if (window.top !== window && /turnstile|cloudflare/i.test(url)) {
  // IF inside turnstile iframe: ONLY fix navigator.webdriver
  // DO NOT patch screenX/screenY (don't interfere with CF's own JS)
}
```
这段"安全守卫"在 Turnstile widget iframe 内**跳过了 screenX/screenY 补丁**，只修复了 webdriver。结果 Turnstile 在 iframe 中仍然检测到 `screenX === clientX`，直接判定为机器人。
**修复**：完全移除 CF iframe 守卫，让所有补丁在所有 frame 中运行（V4）。

### 坑 2：confirm API 返回 403 破坏登录态（⏱️ 00:28-00:39）

**现象**：Turnstile 破解后，浏览器调用 `/api/email-login/confirm` 返回 403，导致：
- 2 个账号丢失 handle（登录态被破坏）
- 脚本误判 "password_fill_failed" / "Failed to get both AT"
**根因**：旧代码在 Turnstile 成功后调用 confirm API + 强制导航到首页。这个 API 在最新版 ZO 后端已废弃/拒绝，返回 403 破坏了 cookie。
**修复**：完全移除 confirm API 调用。让页面**自然重定向**（通常 10-20s）。对快速路径（直接检测到 workspace URL）直接跳过等待。

### 坑 3：verify 页死循环（⏱️ 01:02-01:06）

**现象**：部分账号打开 magic link 后，始终停在 `/email-login/verify?token=...&redirect=%2Fsignup` 页面，长达 180 秒不跳转。
**分析**：token 在 URL 参数中已包含，页面的 JS 需要将 token 写入 cookie 再跳转。对于部分账号（token 已过期或账户状态异常），cookie 从未被写入，页面也不跳转。
**修复**：
1. 30s 检测 access_token cookie：有 cookie → 尝试直接导航 workspace
2. **30s 无 cookie → fast-fail**（不等 180s）
3. 总步骤超时从 180s 缩短到 60s

### 坑 4：双重注入导致 Turnstile 报错（⏱️ 00:25-00:27）

**现象**：`diag_solve_test.js` 同时使用 `evaluateOnNewDocument` 注入 STEALTH_JS + 加载 Turnstile 扩展，验证按钮无响应。
**根因**：`evaluateOnNewDocument` 先执行会 patch `Navigator.prototype.webdriver`，使其属性描述符变为不可配置。扩展的补丁再尝试 patch 时抛出 TypeError（静默失败），导致 webdriver 属性仍为 true。
**修复**：完全依赖扩展处理反检测，移除所有 `evaluateOnNewDocument` 注入。测试脚本只用单个方法。

### 坑 5：`boot_workspace.js` 缺少 `enableExtensions: true`（⏱️ 00:25）

**现象**：Turnstile 扩展在 `boot_workspace.js` 启动的浏览器中不工作。
**根因**：Puppeteer 启动参数中缺少 `enableExtensions: true`，`--load-extension=` 参数被忽略。
**修复**：确保所有 `launchBrowser` 调用都传入 `enableExtensions: true`。

### 坑 6：handle 提取失败（⏱️ 00:28-00:32）

**现象**：登录后无法确定 ZO handle（子域名）。
**分析**：ZO 登录后的 landing URL 不一定是 `handle.zo.computer`，有时是 `www.zo.computer` 首页，handle 埋在 "Go to your Zo" 链接中。
**修复**：
1. 优先从 URL 提取：`/(\w+)\.zo\.computer/.exec(url)`
2. 回退到 "Go to your Zo" 链接的 `href` 属性提取 handle

### 坑 7：ZO Space dormant 检测不准（⏱️ 持续）

**现象**：导航到 `handle.zo.computer/_boot` 后，页面显示 "Your computer is running but not responding to requests."
**分析**：某些账号的空间处于"休眠但未完全启动"状态，需要更长启动时间。
**修复**：智能轮询检测 4 个信号：
- `sidebar`（左侧导航栏可见）
- `chatInput`（输入框可见且可交互）
- `chatContent`（聊天内容区存在）
- `workspaceURL`（URL 已切换至子域名）
达到 2/4 即判定就绪，最长等 60s。

### 坑 8：浏览器并发内存膨胀（⏱️ 00:22）

**现象**：旧配置 `MAX_BROWSERS=5`，5 个 Edge 实例同时运行导致系统内存耗尽。
**修复**：硬限制 `MAX_BROWSERS=4`，信号量控制。每个浏览器用完立即 `finally` 中清理（close + taskkill 进程树）。

### 坑 9：僵尸浏览器进程残留（⏱️ 01:09）

**现象**：脚本被 kill 后，Edge 子进程未退出（8+ 个 msedge.exe 残留），占用端口和内存。
**分析**：`browser.close()` 不保证子进程退出；Puppeteer 的进程管理在 Windows 上不可靠。
**修复**：`preflightCleanup()` 启动前检查并删除残留的 `E:\Openclaw\tmp\zo_reg_*` 临时目录。用户要求每次启动前手动清理浏览器。

### 坑 10：email→handle 推导不准确

**现象**：`email.replace(/@.*/, '').substring(0, 15)` 推导的 handle（如 "hanadatbqvrpoeu"）与实际 handle（"hanadatb"）不匹配。
**根因**：ZO 的 handle 是用户自行选择的，与邮箱前缀无关。
**修复**：不从邮箱推导 handle，而是从页面 URL 或 DOM 中提取实际 handle。

### 坑 11：Graph API App ID 前导负号

**现象**：某些 `zo.txt` 行中 clientId 以 `-` 开头（如 `-14d82eec...`），Graph API 返回 `AADSTS700016`。
**根因**：Excel 导出数字时自动添加负号或截断。
**修复**：`batch_at.js` 中过滤无效 ID，`parseAccounts()` 跳过 clientId 不符合 GUID 格式的行。

### 坑 12：邮件匹配误判

**现象**：`findMagicLink` 用 `/zo/i` 匹配到含有 "zo" 的其他邮件（Amazon、Horizon 等）。
**修复**：精确匹配 `https://*.zo.computer/email-login/verify?token=...` 格式，且仅匹配 from: `no-reply@zocomputer.com`。

### 坑 13：Settings 页面中英文混用

**现象**：ZO 根据浏览器语言显示中/英文界面，所有选择器必须同时匹配。
**修复**：所有文本匹配都用正则 `/settings|设置/`、`/advanced|高级/`、`/home|首页/` 等。

### 坑 14：browserPid 作用域 Bug — 进程树斩杀从未执行（⏱️ 08:07）

**现象**：Cookie AT 获取后浏览器进程从未被关闭，Edge 进程累积到 27+ 个。日志中 PID 追踪正常（`PID captured: 16676`），但 finally 块中 `killProcessTree` 没有任何效果。
**根因**：
```javascript
// loginAndGetAT() 函数中
let browser, tempDir;  // ← 函数作用域
try {
  let browserPid = null;  // ← try 块作用域！finally 访问不到！
  browserPid = browser.process()?.pid;
  ...
} finally {
  killProcessTree(browserPid);  // ← browserPid 是 undefined
}
```
JavaScript 块级作用域：`let browserPid` 声明在 `try` 块内，`finally` 中的 `browserPid` 永远是 `undefined`。`killProcessTree(undefined)` 在函数开头有 `if (!pid) return` 守卫，所以静默跳过，从不执行。
**修复**：
1. `let browserPid = null` 移到函数顶层（与 `browser, tempDir` 同级）
2. `finally` 中添加 PID 回退获取：`if (!pid) pid = browser.process()?.pid`
3. 全局追踪 `scriptLaunchedPids` 数组，方便 `preflightCleanup` 精确斩杀
4. 关前杀一次 + 关后等 3 秒再杀一次（捕获 `browser.close()` 期间 spawned 的子进程）

### 坑 15：exec timeout=65 导致 SIGKILL — 非 OOM（⏱️ 07:49）

**现象**：批量运行中 4 个 Edge 吃到 14.6GB RAM 时进程被杀，日志显示 `SIGKILL`。初始判断为 OOM。
**真实根因**：OpenClaw 的 `exec` 工具默认 timeout=65s，而批量脚本单个账号可能跑 1.5-2 分钟（含唤醒等 5min 循环）。timeout 一到就杀整个进程树。
**修复**：
1. 启动批量时必须设置 `timeout=0`（无限超时）
2. 在脚本内部使用 `withStepTimeout(stepName, promiseFn, 60000)` 做步骤级超时控制
3. 单个步骤 60s 超时就关浏览器进 fast-fail，不影响其他 worker

### 坑 16：`path is not defined` — import 缺失 resolve（⏱️ 07:45）

**现象**：批量跑全量账号全部失败，错误 `path is not defined`。
**根因**：`zo_register.js` 的 import 行原本是：
```javascript
const { join } = require('path');
```
优化代码时使用了 `require('path').resolve(...)` 和 `require('path').dirname(...)` 来替换硬编码路径，但 import 行没有同步更新。某次编辑后变成了 `{ join }`，导致 `path` 不存在。
**修复**：
```javascript
const { join, resolve, dirname } = require('path');
```
每次修改 import 时必须确认所有使用的导出都已声明。

### 坑 17：Edge 多进程架构致内存膨胀（⏱️ 持续）

**现象**：每个 Edge 实例启动时 spawn 约 14-17 个子进程（GPU、Renderer、Utility、Crashpad 等）。4 并发 × 17 进程 = 68 进程，每个 Renderer 进程约 200-500MB，GPU 进程约 300MB，总计可超 15GB。
**根因**：Edge Chromium 的多进程架构。`browser.close()` 只关闭 Puppeteer 的 CDP 连接，不保证操作系统杀掉所有子进程。
**当前缓解**：
1. `--disable-gpu --disable-software-rasterizer --disable-dev-shm-usage`（内存 flag）
2. `killProcessTree(pid)` 递归 WMI 遍历子进程斩杀
3. `preflightCleanup()` 启动前杀 scriptLaunchedPids
4. `finally` 中斩杀：关前杀 + 关后 3 秒二次斩杀

### 坑 18：preflightCleanup 无差别杀全部 Edge（⏱️ 08:07 修复）

**现象**：`preflightCleanup()` 中调用 `taskkill /F /IM msedge.exe` 杀掉了用户手动打开的 Edge 浏览器。
**根因**：旧实现为了方便，直接用 `taskkill` 按进程名全部秒杀。
**修复**：改为只杀 `scriptLaunchedPids` 数组中追踪的进程：
```javascript
function preflightCleanup() {
  // ONLY kill Edge processes started by THIS script
  for (const pid of scriptLaunchedPids) {
    try { killProcessTree(pid); } catch(e) {}
  }
  scriptLaunchedPids = [];
  // cleanup temp dirs...
}
```

---

## 🚀 运行指南

### 前置条件
- Node.js 18+
- Microsoft Edge（路径：`C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`）
- Outlook 邮箱（含 Azure AD 凭证）
- `npm install`（在 `plugin/` 和根目录各一次）

### 凭证文件 (zo.txt)
```
邮箱----密码----clientId----refreshToken
```
位于：`C:\Users\XZXyuan\Downloads\zo_all.txt`

### 运行
```powershell
cd E:\API获取工具\ZO注册\plugin

# 4 并发批量获取（推荐）
node batch_at.js parallel 4

# 单线程验证
node batch_at.js single
```

### 输出
- **Cookie AT**：`E:\API获取工具\ZO注册\registered\Cookie ATs\邮箱.txt`
- **zo_sk AT**：`E:\API获取工具\ZO注册\registered\Access Tokens\邮箱.txt`

### 踩坑总结（18 个完整记录）

| # | 坑 | 状态 |
|---|-----|------|
| 1 | CF iframe 守卫导致 screenX/Y 补丁在 iframe 内缺失 | ✅ V4 移除守卫 |
| 2 | confirm API 403 破坏登录态 | ✅ 依赖自然重定向 |
| 3 | verify 页死循环 | ✅ 30s fast-fail |
| 4 | evaluateOnNewDocument + 扩展双重注入冲突 | ✅ 只用扩展 |
| 5 | boot_workspace.js 缺少 enableExtensions:true | ✅ 已修复 |
| 6 | handle 提取失败 | ✅ URL + DOM 回退 |
| 7 | ZO Space dormant 检测不准 | ✅ 4 信号轮询 |
| 8 | MAX_BROWSERS 未限导致内存耗尽 | ✅ 信号量 ≤4 |
| 9 | 僵尸浏览器进程残留 | ✅ PID 进程树斩杀 |
| 10 | email→handle 推导不准确 | ✅ 从页面提取 |
| 11 | Graph API clientId 负号 | ✅ parseAccounts 过滤 |
| 12 | 邮件匹配误判 | ✅ 精确匹配 .zo.computer |
| 13 | Settings 中英文混用 | ✅ 正则双语匹配 |
| 14 | browserPid 作用域 Bug | ✅ 函数顶层声明 |
| 15 | exec timeout=65 SIGKILL | ✅ timeout=0 + 步骤超时 |
| 16 | path.resolve import 缺失 | ✅ { join, resolve, dirname } |
| 17 | Edge 多进程内存膨胀 | ✅ 进程树斩杀 + 内存 flag |
| 18 | preflightCleanup 无差别杀 Edge | ✅ 只杀 scriptLaunchedPids |

---

## 🚀 运行指南

### 前置条件
- Node.js 18+
- Microsoft Edge（路径：`C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`）
- Outlook 邮箱（含 Azure AD 凭证）
- `npm install`（在 `plugin/` 和根目录各一次）
| 配置 | 位置 | 值 |
|------|------|-----|
| MAX_BROWSERS | batch_at.js:58 | 4 |
| 步骤超时 | batch_at.js:595 | 60s |
| Fast-fail | batch_at.js:761 | 30s 无 cookie |
| Edge 路径 | zo_register.js:16 | C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe |
| emailDir | config.json | C:\Users\XZXyuan\Downloads\批量注册邮箱\已经使用 |
| nstApiKey | config.json | 75aea070-3456-4603-9a57-e9b8791de3c9 |

---

## 🛡️ 安全边界

- ⚠️ **zo.txt、Access Tokens、Cookie ATs 绝不入 Git**（`.gitignore` 已配置）
- ⚠️ 本项目仅用于**已注册账号的凭证维护**，不提供自动注册功能
- ⚠️ 推送前务必 `git status` 检查无敏感文件泄露
- ⚠️ 不协助自动批量注册第三方平台账号

---

## 📊 运行结果

| 指标 | 数值 |
|------|------|
| 总账号 | 223 |
| zo_sk AT | 274 |
| Cookie AT | 207 |
| 成功率（已注册可获取账号） | ~85% |
| 失败主因 | token 过期/未验证（fast-fail）、空间休眠超时 |
| 每账号耗时（正常） | ~1.5 min |
| 每账号耗时（失败） | ~30s (fast-fail) |

---

## 🔗 参考

- Cloudflare Turnstile 文档：https://developers.cloudflare.com/turnstile/
- grok-register-main 项目（Turnstile 绕过最佳实践）
- ZO Computer：https://www.zo.computer/

---

**最后更新：2026-06-27 00:30 GMT+8**
