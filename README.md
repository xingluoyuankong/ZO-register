# ZO Computer 自动注册 & Access Token 获取工具

自动化完成 [zo.computer](https://www.zo.computer) 账号注册和 Access Token 获取，支持批量并行处理。

---

## 📁 项目结构

```
ZO注册/
├── plugin/                          # 核心插件目录（推荐使用）
│   ├── zo_register.js               # 核心注册逻辑 + AT 获取（Puppeteer）
│   ├── batch_at.js                  # 批量 Access Token 获取脚本
│   ├── server.js                    # Web UI 服务（Express + WebSocket）
│   ├── temp_mail.js                 # 临时邮箱服务集成（9 个 provider）
│   ├── config.json                  # 插件配置
│   ├── start.bat                    # 一键启动 Web UI
│   └── public/index.html            # Web UI 前端
├── turnstile-extension/             # Cloudflare Turnstile 绕过扩展
│   ├── manifest.json                # MV3 扩展清单
│   ├── script.js                    # 核心绕过逻辑（MAIN world 注入）
│   └── background.js                # Service Worker
├── registered/                      # 注册结果（⚠️ 不入 Git）
│   ├── Access Tokens/               # AT 文件目录
│   ├── results.jsonl                # 注册结果日志
│   └── at_results.jsonl             # AT 获取结果日志
├── server.cjs                       # 独立版完整注册服务（旧版）
├── config.json                      # 根级配置
├── package.json
└── README.md
```

---

## 🔑 核心原理

### 1. 注册流程

```
打开 signup 页面 → 点击 "Email me a sign-up link"
    → 填写邮箱 → 提交
    → Graph API 轮询 Outlook 收件箱获取 Magic Link
    → 打开 Magic Link（Turnstile 扩展自动破解验证）
    → 等待跳转到 /signup
    → 设置 Handle → 等待 ZO Space 启动（_boot → chat）
    → 进入 Settings → Advanced → 创建 Access Token
```

### 2. Cloudflare Turnstile 绕过

**根因**：Turnstile 检测 `MouseEvent.screenX === clientX` 判定为机器人（真实用户 screenX = clientX + 窗口偏移）。

**方案**：Chrome MV3 扩展 + `world: "MAIN"` + `all_frames: true` + `run_at: "document_start"`

```
┌─────────────────────────────────────────────┐
│  扩展 script.js (MAIN world, document_start) │
│                                              │
│  L1: MouseEvent.screenX/screenY 伪装         │
│      screenX = clientX + random(100~199)     │
│      screenY = clientY + random(60~139)      │
│                                              │
│  L2: navigator 属性伪装                      │
│      webdriver=undefined, plugins补全        │
│      hardwareConcurrency=8, deviceMemory=8   │
│                                              │
│  L3: chrome.runtime 补全                     │
│                                              │
│  L4: 清除 cdc_ 自动化痕迹                    │
└─────────────────────────────────────────────┘
```

**为什么用扩展而非 evaluateOnNewDocument：**
- `evaluateOnNewDocument` 在主 frame 注入，**无法穿透 Turnstile iframe（Shadow DOM）**
- 扩展的 `all_frames: true` + `world: "MAIN"` 确保注入到**所有 iframe 包括 Shadow DOM 内**

### 3. Magic Link 获取

通过 Microsoft Graph API 轮询 Outlook 收件箱：

```
POST https://login.microsoftonline.com/consumers/oauth2/v2.0/token
  → 用 refreshToken 获取 accessToken
GET https://graph.microsoft.com/v1.0/me/messages
  → 过滤 ZO 邮件（from: no-reply@zocomputer.com）
  → 提取 https://*.zo.computer/email-login/verify?token=... 链接
```

### 4. Access Token 获取

登录后导航到 Settings → Advanced → Access Tokens 区域：

```
Settings 页面 → CDP 点击 Advanced tab
  → 精确定位 Access Tokens 区域的 Key name 输入框
  → 填入名称 → 点击该区域下方的 Add 按钮
  → 等待 Token 生成 → 提取 zo_sk_* 格式 Token
```

---

## 🚀 快速开始

### 前置条件

- Node.js 18+
- Microsoft Edge 或 Chrome 浏览器
- Outlook/Hotmail 邮箱（含 Graph API 凭证）
- `npm install` 安装依赖

### 凭证文件格式 (zo.txt)

```
邮箱----密码----clientId----refreshToken
```

每行一个账号，四段用 `----` 分隔：
- **邮箱**：Outlook/Hotmail 邮箱地址
- **密码**：邮箱密码
- **clientId**：Microsoft Azure AD 应用 ID
- **refreshToken**：OAuth2 refresh token（consumers endpoint）

### Access Token 输出格式

```
email: xxx@outlook.com
handle: userhandle
zoAddress: userhandle.zo.computer
accessToken: zo_sk_xxxxx...
time: 2026-06-21T11:41:22.742Z
```

---

### 方式一：批量获取 AT（推荐）

```powershell
cd plugin

# 单线程测试（先跑 2 个账号验证流程）
node batch_at.js single

# 多线程并行（4 并发，自动跳过已有 AT 的账号）
node batch_at.js parallel 4
```

### 方式二：Web UI

```powershell
cd plugin
node server.js
# 浏览器访问 http://localhost:3456
```

### 方式三：单账号测试

```powershell
cd plugin
node test_run.js
```

---

## ⚙️ 配置说明

### plugin/config.json

```json
{
  "emailDir": "C:\\path\\to\\emails",   // 邮箱文件目录
  "browserType": "edge",                 // edge | chrome
  "concurrency": 1                       // 并发数
}
```

### batch_at.js 关键参数

| 参数 | 位置 | 默认值 | 说明 |
|------|------|--------|------|
| `ZO_FILE` | 顶部常量 | `C:\Users\...\zo.txt` | 凭证文件路径 |
| `MAX_BROWSERS` | 信号量 | 4 | 最大同时浏览器数 |
| `MAX_RETRIES` | worker 函数 | 2 | 失败重试次数 |
| `tokenKeyName` | config 对象 | `MyApiKey` | AT 密钥名称 |

---

## ⚠️ 踩坑记录 & 注意事项

### Turnstile 相关

1. **绝对不能同时注入 STEALTH_JS 和加载 Turnstile 扩展**
   - `evaluateOnNewDocument` 的 STEALTH_JS 先执行会 patch `navigator.webdriver`，使属性不可配置
   - 扩展再 patch 时失败 → Turnstile 检测到自动化 → 验证不通过
   - **解决**：完全依赖扩展处理反检测，移除所有 `evaluateOnNewDocument` 注入

2. **扩展路径必须正确**
   - `launchBrowser` 通过 `--load-extension=` 参数加载 `turnstile-extension/` 目录
   - 不能用 `--disable-extensions` 参数（会阻止扩展加载）
   - 不能用 `--incognito`（扩展在隐身模式默认不工作）

3. **不要点击 "Continue in browser" 按钮**
   - 该按钮是错误操作，扩展会自动破解验证并跳转

### Magic Link 相关

4. **findMagicLink 必须精确匹配 zo.computer 域名**
   - 早期用 `/zo/i` 匹配会误匹配含 "zo" 的其他邮件（amazon, horizon 等）
   - 必须匹配 `https://*.zo.computer/email-login/verify?token=...` 格式

5. **Graph API App ID 必须正确**
   - `zo.txt` 中的 clientId 必须是有效的 Azure AD Consumer 应用 ID
   - 前导负号（如 `-14d82eec...`）是无效 ID，会导致 `AADSTS700016` 错误

6. **AADSTS70000 "service abuse mode"**
   - 微软标记账号为滥用模式，无法通过 Graph API 获取邮件
   - 通常是频繁自动化操作触发，目前无法绕过

### Settings / AT 获取相关

7. **Settings 页面可能显示中文**
   - ZO 根据浏览器语言显示中文/英文界面
   - 所有正则必须同时匹配中英文：`settings|设置`、`advanced|高级`
   - 侧边栏关键词：`home|首页`、`files|文件`、`automations|自动化` 等

8. **必须等 ZO Space 完全启动后再访问 Settings**
   - 登录成功后 ZO Space 处于 dormant 状态，需要先 wake/boot
   - 直接访问 `HANDLE.zo.computer/settings` 会返回 404
   - 流程：_boot → 点击 wake 按钮 → 等待 chat interface 加载 → 额外等 15s → 再访问 settings

9. **Access Tokens 区域精确定位**
   - Settings → Advanced 页面有两个区域：Keys（密钥）和 Access Tokens
   - Key name 输入框的 placeholder 匹配 `/key name \(e\.g/i` 才能定位到 AT 区域
   - Add 按钮要点击 "Access Tokens" heading 下方的那个（不是 Keys 区域的）

10. **使用 CDP 原生点击，不用 el.click()**
    - `el.click()` 是合成事件，ZO 前端框架可能不响应
    - 用 Puppeteer 的 `page.mouse.click(x, y)` 或 CDP `Input.dispatchMouseEvent`

### 浏览器管理

11. **并发控制：最多 4 个浏览器**
    - 每个浏览器实例占用大量内存和 CPU
    - `batch_at.js` 用信号量（acquireBrowserSlot/releaseBrowserSlot）控制

12. **临时目录清理**
    - 每个浏览器用独立的 `E:\Openclaw\tmp\zo_reg_*` 临时目录
    - `preflightCleanup()` 启动前杀掉残留进程 + 删除遗留目录
    - `cleanupTempDir()` 在 finally 块中 3 次重试删除

13. **浏览器进程树清理**
    - `browser.close()` 后还要 `taskkill /F /T /PID` 杀掉整个进程树
    - 否则 Edge/Chrome 子进程会残留占用资源

### 网络相关

14. **net::ERR_CONNECTION_CLOSED**
    - ZO 服务器临时断连，通常是频率过高或 IP 被临时限流
    - 重试通常能解决，脚本内置 2 次重试

---

## 🛠️ 依赖

| 包名 | 用途 |
|------|------|
| `puppeteer-core` | 浏览器自动化（使用系统 Edge/Chrome） |
| `express` | Web UI HTTP 服务 |
| `ws` | WebSocket 实时通信 |

> 注意：使用 `puppeteer-core` 而非 `puppeteer`，需要系统已安装 Edge 或 Chrome。

---

## 📋 导出 API (zo_register.js)

```javascript
const {
  registerOne,        // 完整注册流程（单账号）
  launchBrowser,      // 启动浏览器（含扩展加载）
  getMailToken,       // 获取 Graph API access token
  findMagicLink,      // 从邮件列表中提取 ZO magic link
  pollMagicLink,      // 轮询收件箱获取 magic link
  fetchAccessToken,   // 获取 ZO Access Token
  DEFAULT_CONFIG,     // 默认配置
} = require("./zo_register");
```

---

## ⚠️ 安全提醒

- **凭证文件（zo.txt）和 Access Tokens 目录绝不入 Git**
- `.gitignore` 已配置排除所有敏感文件
- 推送前务必检查 `git status` 确认无凭证泄露
