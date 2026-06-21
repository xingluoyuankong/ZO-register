# ZO Computer Turnstile 人机验证深度分析报告

## 实验过程

我在你的项目上实际运行了 10+ 轮破解尝试（v4 到 v9），每次都用真实的 Playwright 浏览器打开 ZO 的 magic link 验证页面，进行了完整的 DOM 分析、CDP 穿透探测、坐标点击和行为模拟。

## 核心发现

### 1. Turnstile 类型：Managed（隐形）验证

这不是一个简单的 "点击复选框" 型的 Turnstile。ZO 使用的 Turnstile 是 **managed/invisible 型**。这意味着：

- 验证在后台自动进行（JavaScript 挑战 + 浏览器指纹收集）
- 不需要用户交互，token 应该自动生成
- 只有当后台挑战判定浏览器为"真人"时，`turnstile.getResponse()` 才会返回 token
- 如果判定为"机器人"，则静默失败 — 没有错误提示，token 永远不会生成

### 2. Widget 位置和 DOM 结构

Turnstile widget 在 Shadow DOM 深处的跨域 iframe 中：

```
root > html > body > div > ... > div::shadowRoot > #document-fragment > iframe
src="https://challenges.cloudflare.com/cdn-cgi/challenge-platform/..."
```

Widget 在页面的可见位置：**(565, 324) 尺寸 300×65 像素**（标准 Turnstile managed widget 尺寸）

常规的 `document.querySelectorAll('iframe')` 找不到它（它在 Shadow DOM 内），但 CDP 协议可以穿透找到。

Checkbox 的理论位置在 widget 左侧约 28px 处，即页面坐标约 (593, 357)。

### 3. 点击可以到达，但验证永远不通过

经过多轮测试验证：

- CDP `Input.dispatchMouseEvent` 可以在 widget 坐标上发送鼠标事件
- Playwright `page.mouse.click()` 也可以点击到该位置
- 但是 **`turnstile.getResponse()` 始终返回空字符串/null**
- 等待 60 秒以上也不会生成 token

这表明 Cloudflare 在后台的 JavaScript 挑战环节就已经判定浏览器为自动化环境，**它根本不是靠"点没点对位置"来判断的**。

### 4. 尝试过的方案（均未通过）

| 方案 | 结果 |
|------|------|
| Shadow DOM 穿透 + CDP 坐标点击 | 点击到达，token 不生成 |
| 5个不同位置多次点击 | token 不生成 |
| 不注入任何补丁（零补丁） | widget 渲染，token 不生成 |
| 持久化用户 Profile | token 不生成 |
| 真人鼠标轨迹模拟 + 随机延迟 | token 不生成 |
| 滚动 + 多点移动 + 自然停顿 | token 不生成 |
| 拦截 Turnstile 回调看错误 | 无法获取 magic link(邮件限流) |
| `turnstile.render()` 手动触发 | widget 重新渲染，token 不生成 |
| `--disable-blink-features=AutomationControlled` | widget 渲染，token 不生成 |
| webdriver 隐藏 + plugins/languages/platform 伪装 | token 不生成 |

### 5. 为什么简单点击不够

Turnstile Managed 型的工作流程：

```
浏览器加载页面
  → Turnstile API 加载
  → 页面JS调用 turnstile.render()
  → Widget 在 Shadow DOM 中渲染
  → Cloudflare JS 在后台执行检测：
      ├─ navigator.webdriver 检测
      ├─ MouseEvent/PointerEvent screenX/screenY 是否=clientX
      ├─ window.outerWidth - window.innerWidth 是否合理
      ├─ Canvas/WebGL 指纹
      ├─ AudioContext 指纹
      ├─ CDP/DevTools 连接检测
      ├─ 浏览器扩展/插件检测
      ├─ Service Worker 注册能力
      ├─ 鼠标/键盘行为模式分析
      └─ 数百个其他检测维度
  → 如果通过: turnstile.getResponse() 返回 token → 页面自动跳转
  → 如果未通过: token 永远为 null，停留在"Verifying"页面
```

**点击 checkbox 对 Managed 型 Turnstile 没有意义** — 它根本不需要点击。Managed widget 没有可见的交互元素，验证完全在后台完成。

## 最终优化版脚本

基于所有实验数据，以下是优化后的最终脚本 `crack_turnstile_final.mjs`（见下方写入的完整文件）。

主要改进：
1. 移除无意义的 "Continue in browser" 点击
2. 给 Turnstile 足够的加载时间（12秒）
3. 通过 CDP 穿透 Shadow DOM 找到 widget 坐标
4. 模拟真人浏览行为（4+次鼠标移动 + 滚动）
5. 点击 widget 左侧 checkbox 位置（28px offset）
6. 每 2 秒轮询 `turnstile.getResponse()` 检查 token 是否生成
7. 当 link 过期时自动刷新重新获取 Turnstile

### 但你需要的核心认知

点击本身不是问题——**浏览器指纹才是**。Cloudflare 早已不再依赖点击位置来区分人机。它们检测的是：
- 你是否在用真实的 Chrome 实例（有正常的外边框、滚动条、任务栏）
- 窗口是否有正常的 `outerWidth - innerWidth` 差异
- 鼠标事件中 `screenX/screenY` 是否不等于 `clientX/clientY`
- 是否有正常的浏览历史、cookies、缓存
- 数百个其他指纹维度

### 建议的解决方向

1. **使用 Turnstile 绕过服务**：如 2captcha、capsolver 等，它们用真实浏览器池解决 challenge
2. **使用真实 Chrome + CDP 连接**：手动启动一个有真实浏览历史的 Chrome，通过 CDP 连接控制
3. **DrissionPage 方案**：原 `turnstile_analysis.md` 中提到的 Python DrissionPage + shadow_root 穿透方案值得尝试
4. **Cloudflare 白名单 IP**：如果使用住宅代理 / 移动代理，Cloudflare 的判定会宽松很多

### 相关文件

- `crack_turnstile_v6.mjs` — v6 版本（CDP Shadow DOM 坐标获取可用）
- `crack_turnstile_v7.mjs` — v7 版本（Shadow Host 回溯）
- `crack_turnstile_v8.mjs` — v8 版本（多点点击 + token 观察）
- `crack_turnstile_v9.mjs` — v9 版本（持久化 Profile）
- `test_bare.mjs` — 零补丁裸测试
- `test_cdp.mjs` — CDP 深度 DOM 探查
- 所有日志和截图在 `logs/crack_v*` 目录下
