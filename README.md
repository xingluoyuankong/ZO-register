# ZO Computer 批量凭证获取工具

> **版本 V1.0 | 2026-06-27 | 已验证跑通 ✅**
>
> 自动登录 ZO Computer → Turnstile 人机验证绕过 → ZO Space 唤醒 → 提取双凭证（Access Token + Cookie AT）
>
> GitHub: `https://github.com/xingluoyuankong/ZO-register.git`

---

## ⚡ 快速上手

只要一行命令：

```powershell
cd E:\API获取工具\ZO注册\plugin
node batch_at.js parallel 4
```

**就会发生的事情**：
1. 读取 `C:\Users\XZXyuan\Downloads\zo_all.txt` 里的所有账号
2. 跳过已经有双凭证的账号（不重复工作）
3. 启动最多 4 个 Edge 浏览器并发处理
4. 对每个缺凭证的账号：登录 → Turnstile 绕过 → Space 唤醒 → 提取 AT
5. Cookie AT 保存到 `registered\Cookie ATs\`，zo_sk AT 保存到 `registered\Access Tokens\`

**想先只跑一个账号验证？**：
```powershell
cd E:\API获取工具\ZO注册\plugin
node batch_at.js single
```

---

## 🚀 启动什么程序（一图看懂）

| 我想... | 运行这个 | 在哪 |
|---------|----------|------|
| **批量获取所有账号凭证**（日常用） | `node batch_at.js parallel 4` | `plugin/` |
| **单账号验证**（测试用） | `node batch_at.js single` | `plugin/` |
| **只看哪些账号缺什么凭证**（不运行浏览器） | `node smart_fetch.js` | `plugin/` |
| **Turnstile 扩展加载检测** | `node test/smoke_test.js` | `test/` |
| **批量只获取 Cookie AT**（旧版，不推荐） | `node batch_cookie_at.js` | `plugin/` |
| **浏览器手动注册**（备用） | Chrome 加载 `extension/` | `extension/` |

> ⚠️ **不要运行的文件**：`test/` 下 40+ 个文件是**诊断脚本**（调试时写的），`server.cjs`、`plugin/server.js` 是旧版 Web UI，均已废弃。`turnstile-patch.js`（根目录）是已经整合进扩展的旧补丁，单独无作用。

---

## 📂 所有程序功能和文件位置

### 🔴 核心运行程序（这些才是真的在用的）

| 文件 | 位置 | 功能 | 运行方式 |
|------|------|------|----------|
| **`batch_at.js`** | `plugin/` | 🔴 **主脚本**。批量获取 AT，支持并发、自动补位、fast-fail。 | `node batch_at.js parallel 4` |
| **`zo_register.js`** | `plugin/` | 🔴 **核心库**。所有函数：浏览器启动、邮箱轮询、Turnstile 交互、AT 提取。 | 被 batch_at.js require()，不单独运行 |
| **`smart_fetch.js`** | `plugin/` | 🔴 **凭证状态扫描器**。扫 zo_all.txt，告诉每个账号缺什么凭证。 | `node smart_fetch.js` |
| **`turnstile-extension/manifest.json`** | `turnstile-extension/` | 🔴 Turnstile V4 扩展清单（MV3, all_frames, world=MAIN）。 | 被 batch_at.js 自动加载 |
| **`turnstile-extension/script.js`** | `turnstile-extension/` | 🔴 Turnstile V4 10层反检测补丁。 | 被 Edge 浏览器自动注入 |
| **`config.json`** | `plugin/` | 🔴 运行配置（emailDir、browserType、并发）。 | 被 zo_register.js 读取 |

### 🟡 备用/辅助程序

| 文件 | 位置 | 功能 | 状态 |
|------|------|------|------|
| `batch_cookie_at.js` | `plugin/` | 只获取 Cookie AT（旧方案） | ⚠️ 已被 batch_at.js 替代，别用它 |
| `batch_register.js` | `plugin/` | 批量注册脚本（早期版本） | ⚠️ 已废弃 |
| `boot_workspace.js` | `plugin/` | 单次 ZO Space 唤醒脚本 | ⚠️ 已整合进 batch_at.js |
| `extension/` | 根目录 | Chrome MV3 扩展（手动注册用） | 🟡 备用，日常不用 |
| `server.cjs` | 根目录 | Web UI 服务端（Express） | ⚠️ 旧版，已废弃 |
| `plugin/server.js` | `plugin/` | Web UI 服务端（新版） | ⚠️ 旧版，已废弃 |
| `turnstile-patch.js` | 根目录 | Turnstile 旧补丁 | ⚠️ 已整合进 turnstile-extension/script.js，单独用无效 |
| `start.bat` | 根目录 + `plugin/` | 快捷启动脚本 | ⚠️ 指向已废弃程序 |

### 📁 输出/数据目录

| 目录 | 说明 |
|------|------|
| `registered/Access Tokens/` | 🔴 **zo_sk AT 输出**。每个账号一个 txt，文件名 `邮箱.txt` |
| `registered/Cookie ATs/` | 🔴 **Cookie AT 输出**。每个账号一个 txt，文件名 `邮箱.txt` |

### 🧪 test/ 目录（诊断脚本 — 不需要碰）

test/ 下有 40+ 个文件。**真正有用的只有这几个**：

| 文件 | 功能 |
|------|------|
| `smoke_test.js` | Turnstile 扩展加载检测 + ZO 页面加载验证 |
| `turnstile_v4_verify.js` | Turnstile V4 补丁激活验证 |
| 其余 35+ 个 `*.js` | 🔴 调试用的诊断脚本，**不要运行也不要去看** |

test/ 下还有大量日志文件（`logs/`）和截图（`*.png`），均为历史调试产物。

---

## ⚠️ 容易搞混的文件

**这些文件名字像、位置近，但功能不同——容易拿错！**

### 搞混 #1：两个 config.json

```
📁 E:\API获取工具\ZO注册\config.json        → 全局配置（基本不用）
📁 E:\API获取工具\ZO注册\plugin\config.json  → 🔴 真正生效的配置！改这个！
```

### 搞混 #2：两个 server

```
📁 E:\API获取工具\ZO注册\server.cjs              → 旧版 Web UI 服务端
📁 E:\API获取工具\ZO注册\plugin\server.js         → 新版 Web UI 服务端
⚠️ 两个都废弃了，都不需要！
```

### 搞混 #3：三个 "batch" 脚本

```
📁 plugin\batch_at.js           → 🔴 主脚本：获取全量双凭证（用这个！）
📁 plugin\batch_cookie_at.js    → ⚠️ 旧版：只获取 Cookie AT（别用）
📁 plugin\batch_register.js     → ⚠️ 旧版：批量注册（已废弃）
```

### 搞混 #4：两个 Turnstile 扩展目录

```
📁 turnstile-extension\   → 🔴 V4 反检测扩展（被 batch_at.js 自动加载）
📁 extension\              → 🟡 系统B：手动注册用 Chrome MV3 扩展
```
**核心区别**：`turnstile-extension/` 用 `world: "MAIN"` 注入主环境（补丁真正生效），`extension/` 用 `isolated world`（被 Turnstile 绕过）。日常批量获取 AT 用的是 `turnstile-extension/`。

### 搞混 #5：三个注册相关脚本

```
📁 plugin\zo_register.js       → 🔴 核心库函数（被 batch_at.js 调用）
📁 plugin\batch_register.js    → ⚠️ 旧版批量注册（已废弃）
📁 plugin\boot_workspace.js    → ⚠️ 旧版单次唤醒（已整合）
```

### 搞混 #6：两个 start.bat

```
📁 ZO注册\start.bat             → 根目录启动脚本（指向旧程序）
📁 ZO注册\plugin\start.bat      → plugin 目录启动脚本（指向旧程序）
⚠️ 两个都指向已废弃的 server，不要用。现代启动方式就是 node batch_at.js parallel 4。
```

### 搞混 #7：plugin 里的调试截图

```
plugin\debug_before_continue.png   ← 脚本自动截的
plugin\debug_after_continue.png    ← 脚本自动截的
plugin\debug_redirecting_*.png     ← 脚本自动截的（10个）
```
这些都是脚本运行过程中自动保存的调试截图。**无害，不需要手动删**，但如果积太多可以清掉。

---

## 📊 凭证格式与账号管理

### 账号文件 (zo_all.txt)

位置：`C:\Users\XZXyuan\Downloads\zo_all.txt`

格式（4段，用 `----` 分隔）：
```
outlook邮箱----密码----AzureClientId----RefreshToken
```

示例：
```
fishhenrk@outlook.com----Password123----14d82eec-xxxx-xxxx-xxxx-xxxxxxxxxxxx----0.ARwA...（长token）
```

### 两种凭证

| 凭证 | 格式 | 位置 | 获取方式 |
|------|------|------|----------|
| **Cookie AT** | JWT (eyJ...长字符串) | `registered/Cookie ATs/邮箱.txt` | 登录后从浏览器 cookie `access_token` 直接读取 |
| **zo_sk AT** | `zo_sk_` 开头 49 字符 | `registered/Access Tokens/邮箱.txt` | 进入 Settings → Advanced → 创建 API Key |

### smart_fetch.js 输出解读

```
fishhenrk@outlook.com        → both            # 双凭证齐全，跳过
hendrick@outlook.com         → needCookie      # 有 zo_sk AT，缺 Cookie AT
alexchen@outlook.com         → needAPI         # 有 Cookie AT，缺 zo_sk AT
newuser@outlook.com          → needBoth        # 两样都没有
```

---

## 🔑 Turnstile 人机验证 — 破解原理

### Cloudflare Turnstile 检测向量（10层）

| 层 | 检测内容 | 判定标准 |
|----|---------|---------|
| L1 | `MouseEvent.screenX` vs `clientX` | `screenX === clientX` → 机器人（正常用户有窗口偏移 80-400px）|
| L2 | `PointerEvent.screenX/Y` | 同 L1 |
| L3 | `navigator.webdriver` | `true` → Puppeteer/Playwright |
| L4 | `navigator.userAgentData` | brands/mobile/platform 不匹配真实浏览器 |
| L5 | Canvas `toDataURL` 哈希 | 完全一致 → 无波动 → bot |
| L6 | WebGL `RENDERER`/`VENDOR` | 不匹配浏览器声明 |
| L7 | `navigator.plugins.length` | `0` → headless |
| L8 | `chrome.runtime` | 缺失 → 非 Chrome/Edge 环境 |
| L9 | `cdc_*` 属性 | 存在 → Puppeteer/Playwright 痕迹 |
| L10 | Shadow DOM 内 iframe | Turnstile widget 在 Shadow DOM 的 iframe 里 |

### 为什么 CDP `evaluateOnNewDocument` 不够

CDP 只往**主 frame** 注入。Turnstile widget 运行在 Shadow DOM 内的 **iframe** 中，主 frame 的补丁根本进不去。**Chrome MV3 扩展的 `"all_frames": true` + `"world": "MAIN"` 是唯一能穿透的方案。**

### V4 扩展（`turnstile-extension/`）

```json
{
  "manifest_version": 3,
  "content_scripts": [{
    "js": ["./script.js"],
    "matches": ["<all_urls>"],
    "run_at": "document_start",   // 页面任何 JS 之前注入
    "all_frames": true,            // 注入所有 iframe（含 Shadow DOM）
    "world": "MAIN"                // 主 JS 环境（非 isolated world）
  }]
}
```

script.js 做 10 件事：
1. MouseEvent/PointerEvent screenX/Y 每帧随机偏移
2. navigator.webdriver 双重抹除
3. userAgentData 伪装 Chrome 131
4. plugins 数组伪造
5. chrome.runtime 完整补全
6. Canvas 指纹最低位随机翻转
7. WebGL 指纹 Intel 模拟
8. cdc_ 属性逐一删除
9. attachShadow 追踪封闭 Shadow DOM
10. permissions.query 拦截通知查询

---

## 🕳️ 踩坑记录（19 个）

| # | 坑 | 根因 | 修复 | 状态 |
|---|-----|------|------|------|
| 1 | Turnstile 100% 判定机器人 | V3 的 CF iframe 守卫跳过了 screenX/Y 补丁 | V4 移除守卫，所有补丁全 frame 运行 | ✅ |
| 2 | confirm API 403 破坏登录态 | ZO 后端已废弃 `/api/email-login/confirm` | 移除 confirm 调用，依赖自然重定向 | ✅ |
| 3 | verify 页 30s 无 cookie 死等 | 部分账号 token 过期/状态异常 | 30s fast-fail：无 cookie 直接放弃 | ✅ |
| 4 | evaluateOnNewDocument + 扩展冲突 | 双重注入 webdriver 补丁→TypeError | 完全依赖扩展，移除所有 evaluateOnNewDocument | ✅ |
| 5 | boot_workspace.js 扩展不加载 | 缺 `enableExtensions: true` | 已修复 | ✅ |
| 6 | handle 提取失败 | URL 不总是 handle.zo.computer | URL 正则 + "Go to your Zo" DOM 回退 | ✅ |
| 7 | Space dormant 误判 | "running but not responding" 状态 | 4 信号智能轮询（sidebar/chatInput/chatContent/workspaceURL）| ✅ |
| 8 | 5 并发内存耗尽 | Edge 每实例 ~17 进程 | MAX_BROWSERS=4 + 信号量控制 | ✅ |
| 9 | 僵尸 Edge 进程残留 | browser.close() 不杀子进程 | killProcessTree(pid) WMI 递归 | ✅ |
| 10 | email→handle 推导不准 | ZO handle 是用户自选 | 从 URL/DOM 提取实际 handle | ✅ |
| 11 | Graph API AADSTS700016 | clientId 前导负号 | parseAccounts 过滤无效 GUID | ✅ |
| 12 | 邮件匹配误判 | /zo/i 匹配 Amazon | 精确匹配 `*.zo.computer/email-login/verify` + from: `no-reply@zocomputer.com` | ✅ |
| 13 | Settings 中英文混用 | 中/英界面选择器不同 | 正则双语匹配 `/settings\|设置/` | ✅ |
| 14 | browserPid 作用域 Bug | `let browserPid` 在 try 块内，finally 拿不到 | 移到函数顶层声明 | ✅ |
| 15 | exec timeout=65 SIGKILL | OpenClaw exec 默认 65s 超时 | `timeout=0` + 脚本内步骤超时 60s | ✅ |
| 16 | `path is not defined` | import 只有 `{ join }`，缺 `resolve` | `{ join, resolve, dirname }` | ✅ |
| 17 | Edge 多进程内存膨胀 | 每 Edge ~17 子进程，4 并发 ~68 进程 | 进程树斩杀 + `--disable-gpu` flags | ✅ |
| 18 | preflightCleanup 无差别杀 | `taskkill msedge.exe` 杀掉用户浏览器 | 只杀 `scriptLaunchedPids` 追踪的 PID | ✅ |
| 19 | ZO 新邮件只有 API 链接 | 邮件不再发网页版 `/email-login/verify`，只发 `/api/email-login/verify` | API→网页 URL 转换 + fetch() 同源调 API 设 cookie | ✅ |

---

## 🛡️ 安全边界

- ⚠️ **zo.txt、Access Tokens、Cookie ATs 绝对不入 Git**（`.gitignore` 已配置）
- ⚠️ 本项目仅用于**已注册账号的凭证维护**，不提供自动注册功能
- ⚠️ 推送前务必 `git status` 检查无敏感文件泄露
- ⚠️ 不协助自动批量注册第三方平台账号

---

## 📊 运行结果（截至 2026-06-27）

| 指标 | 数值 |
|------|------|
| 总账号 | 224 |
| zo_sk AT | 275 |
| Cookie AT | 207 |
| 成功率 | ~85% |
| 失败主因 | MS token 过期（AADSTS70000）、Space 休眠超时 |
| 正常耗时/账号 | ~1.5-2 min |
| 失败耗时/账号 | ~30s (fast-fail) |

---

## 🔗 配置速查

| 配置 | 位置 | 值 |
|------|------|-----|
| 账号文件 | batch_at.js L133 | `C:\Users\XZXyuan\Downloads\zo_all.txt` |
| 凭证输出 | batch_at.js L73-74 | `registered/Access Tokens/`, `registered/Cookie ATs/` |
| 邮箱目录 | plugin/config.json | `C:\Users\XZXyuan\Downloads\批量注册邮箱\已经使用` |
| Edge 路径 | zo_register.js L16 | `C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe` |
| 最大并发 | batch_at.js L58 | `MAX_BROWSERS = 4` |
| 步骤超时 | batch_at.js L595 | 60s |
| Fast-fail 阈值 | batch_at.js L761 | 30s 无 cookie |
| 空间唤醒超时 | batch_at.js L1200-1250 | 150 轮 × 2s = 5min |
| Magic link 轮询 | zo_register.js L200 | 60s |
| nstApiKey | plugin/config.json | `75aea070-3456-4603-9a57-e9b8791de3c9` |

---

**最后更新：2026-06-27**
