# grok-register-main Turnstile 绕过方案深度分析

## 一、整体架构

```
grok-register-main/
├── DrissionPage_example.py    # 主脚本 (1737行)
├── email_register.py          # GPTMail 临时邮箱
├── turnstilePatch/            # Chrome 扩展 (核心)
│   ├── manifest.json
│   └── script.js
└── config.json
```

## 二、Turnstile 绕过的三层机制

### 第1层：Chrome 扩展注入 (document_start)

```json
// manifest.json
{
    "manifest_version": 3,
    "content_scripts": [{
        "js": ["./script.js"],
        "matches": ["<all_urls>"],
        "run_at": "document_start",
        "all_frames": true,
        "world": "MAIN"
    }]
}
```

```js
// script.js - 极简但关键
let screenX = getRandomInt(800, 1200);
let screenY = getRandomInt(400, 600);
Object.defineProperty(MouseEvent.prototype, 'screenX', { value: screenX });
Object.defineProperty(MouseEvent.prototype, 'screenY', { value: screenY });
```

**关键点**:
- `document_start` + `world: MAIN` = 在页面任何脚本运行前注入
- `all_frames: true` = 对所有 iframe 生效（包括 cross-origin）
- 用 `value` 而非 `get` = 更简单、更稳定
- DrissionPage 的 `add_extension()` 自动加载扩展

### 第2层：Shadow DOM 深度遍历 + iframe 内部操作

```python
def getTurnstileToken():
    # 1. 先 reset Turnstile
    page.run_js("try { turnstile.reset() } catch(e) { }")
    
    for _ in range(15):
        # 2. 尝试直接获取 token
        res = page.run_js("try { return turnstile.getResponse() } catch(e) { return null }")
        if res:
            return res
        
        # 3. 进入 Shadow DOM → iframe → Shadow DOM → 点击 checkbox
        iframe = page.ele("@name=cf-turnstile-response")  # 找到 input
            .parent()                                      # 取父元素
            .shadow_root                                   # 进入 Shadow DOM
            .ele("tag:iframe")                            # 找到 Turnstile iframe
        
        # 4. 在 iframe 内部注入 screenX/screenY 补丁
        iframe.run_js("""
            window.dtp = 1;
            Object.defineProperty(MouseEvent.prototype, 'screenX', { value: 900 });
            Object.defineProperty(MouseEvent.prototype, 'screenY', { value: 500 });
        """)
        
        # 5. 点击 iframe 内部 Shadow DOM 中的 checkbox
        iframe.ele("tag:body")           # iframe 的 body
            .shadow_root                 # 进入 Shadow DOM
            .ele("tag:input")           # 找到 checkbox
            .click()                     # 点击!
        
        time.sleep(WAIT_SHORT_SECONDS)
    
    raise Exception("Turnstile solve failed")
```

**关键点**:
- Turnstile 的 checkbox 在 **iframe 的 Shadow DOM** 中
- 必须逐层穿透: `input.parent().shadow_root.ele("iframe").ele("body").shadow_root.ele("input")`
- 在 iframe 内部 **再次注入** screenX/screenY 补丁（因为 iframe 是独立上下文）
- 点击 checkbox 触发验证

### 第3层：Token 填充

```python
# 获取到 token 后填入 input
page.run_js("arguments[0].value = arguments[1]", 
    page.ele('@name=cf-turnstile-response'), ts_token)

# 或者触发 change 事件
page.run_js("""
    const c = document.querySelector('input[name="cf-turnstile-response"]');
    c.value = arguments[0];
    c.dispatchEvent(new Event('change', { bubbles: true }));
""", ts)
```

## 三、为什么我们的 Puppeteer 脚本失败

| 问题 | grok-register | 我们的脚本 |
|------|--------------|-----------|
| 扩展加载 | `add_extension()` 自动加载 | `--load-extension` 但未生效 |
| iframe 注入 | 扩展 `all_frames: true` 自动注入 | `evaluateOnNewDocument` 只注入主页面 |
| Shadow DOM | `element.shadow_root` 直接访问 | `document.querySelectorAll` 找不到 |
| checkbox 点击 | 穿透 Shadow DOM 点击 | 从未找到 checkbox |
| iframe 内补丁 | `iframe.run_js()` 在 iframe 内注入 | 完全没有 |

## 四、核心发现

**Turnstile 的 checkbox 在一个深层嵌套结构中**:
```
cf-turnstile-response input
└── parent div
    └── shadow_root
        └── iframe (challenges.cloudflare.com)
            └── body
                └── shadow_root
                    └── input (checkbox) ← 需要点击这个!
```

我们的脚本用 `document.querySelectorAll('iframe')` 找不到这个 iframe，因为它在 Shadow DOM 内部。

## 五、解决方案

### 方案A: 改用 DrissionPage (推荐)

DrissionPage 原生支持:
- `add_extension()` 自动加载扩展
- `element.shadow_root` 访问 Shadow DOM
- `iframe.run_js()` 在 iframe 内执行 JS
- `iframe.ele()` 在 iframe 内查找元素

### 方案B: 继续用 Puppeteer + CDP

需要用 CDP 协议:
1. 确保扩展正确加载（`--load-extension` + `--disable-extensions-except`）
2. 用 CDP `DOM.describeNode` 找到 Shadow DOM
3. 用 CDP `Runtime.evaluate` 在 iframe 上下文中执行 JS
4. 用 CDP `Input.dispatchMouseEvent` 点击 checkbox

### 方案C: Puppeteer + evaluateOnNewDocument + 延迟注入

1. 在主页面注入补丁
2. 等待 Turnstile iframe 加载
3. 用 `page.frames()` 找到 Turnstile iframe
4. 在 iframe 中注入补丁
5. 用 `frame.evaluate()` 点击 checkbox
