/**
 * ZO 注册助手 - Content Script
 * 注入到 zo.computer 页面，执行注册操作
 */
(function() {
  if (window.__ZO_REG__) return;
  window.__ZO_REG__ = true;

  const sleep = ms => new Promise(r => setTimeout(r, ms));

  function getText(len) {
    len = len || 800;
    try { return document.body.innerText.substring(0, len); } catch (e) { return ""; }
  }

  function isVisible(el) {
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && el.offsetParent !== null;
  }

  function forceClick(el) {
    if (!el) return false;
    try { el.scrollIntoView({ block: "center", inline: "center" }); } catch (e) {}
    try { el.click(); return true; } catch (e2) {}
    try {
      const rect = el.getBoundingClientRect();
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;
      el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, clientX: x, clientY: y }));
      el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, clientX: x, clientY: y }));
      el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, clientX: x, clientY: y }));
      return true;
    } catch (e3) {}
    return false;
  }

  function clickBtn(pattern) {
    for (const sel of ["button", "a", "div[role=button]", "span", "label", "div"]) {
      for (const el of document.querySelectorAll(sel)) {
        if (pattern.test(el.textContent || "") && isVisible(el)) {
          return forceClick(el);
        }
      }
    }
    return false;
  }
  function fillInput(selector, value) {
    let inp = typeof selector === 'string' ? document.querySelector(selector) : selector;
    if (!inp) return false;
    inp.focus();
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    setter.call(inp, value);
    inp.dispatchEvent(new Event("input", { bubbles: true }));
    inp.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }

  function clearZoCookies() {
    try {
      const domains = [".zo.computer", "zo.computer", ".www.zo.computer", "www.zo.computer"];
      const paths = ["/", "/signup", "/email-login"];
      const cookies = document.cookie.split(";");
      for (const c of cookies) {
        const name = c.split("=")[0].trim();
        if (!name) continue;
        for (const d of domains) {
          for (const p of paths) {
            document.cookie = name + "=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=" + p + ";domain=" + d;
          }
        }
        document.cookie = name + "=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/";
      }
    } catch (e) {}
    try { localStorage.clear(); } catch (e2) {}
    try { sessionStorage.clear(); } catch (e3) {}
  }
  // ========== 步骤 1: 点击邮件按钮 ==========
  async function stepClickEmailBtn() {
    clearZoCookies();
    // 不信任复用页状态：每次账号注册都强制回到 signup，让批量与手工单个注册一致。
    if (!location.href.includes("zo.computer/signup") || !/[?&]zo_batch_ts=/.test(location.href)) {
      location.href = "https://www.zo.computer/signup?zo_batch_ts=" + Date.now();
      await sleep(3000);
    }

    // 英文+中文按钮文本匹配
    const emailButtonPattern = /email\s*(me\s*)?(a\s*)?(sign[-\s]*up|login|log\s*in)?\s*link|sign[-\s]*up\s*link|continue\s*with\s*email|use\s*email|email|使用邮箱|邮箱登录|邮箱注册|继续使用邮箱|通过邮箱|邮箱.*登录|邮箱.*注册|登录.*邮箱|注册.*邮箱/i;
    for (let i = 0; i < 20; i++) {
      const txt = getText(1000);
      if (clickBtn(emailButtonPattern)) {
        await sleep(2000);
        return { ok: true };
      }
      // 英文+中文：已发送邮件状态
      if (/check your email|login link|we sent|查看您的邮箱|查收邮件|我们已发送|登录链接|邮件已发送/i.test(txt)) {
        return { ok: false, error: "页面停留在已发送邮件状态，未回到全新注册页" };
      }
      await sleep(1000);
    }
    return { ok: false, error: "找不到邮件按钮; url=" + location.href + "; text=" + getText(180).replace(/\n/g, " ") };
  }
  // ========== 步骤 2: 填写邮箱 ==========
  async function stepFillEmail(email) {
    if (!fillInput("input[type=email], input#email, input[name=email]", email)) {
      return { ok: false, error: "找不到邮箱输入框" };
    }
    await sleep(500);
    // 英文 Continue + 中文 继续
    clickBtn(/^Continue$|^继续$/i);
    await sleep(3000);
    const txt = getText(400);
    // 英文+中文：邮件已发送确认
    if (/check your email|login link|we sent|查看您的邮箱|查收邮件|我们已发送|登录链接|邮件已发送/i.test(txt)) return { ok: true };
    clickBtn(/^Continue$|^继续$/i);
    await sleep(3000);
    if (/check your email|login link|we sent|查看您的邮箱|查收邮件|我们已发送|登录链接|邮件已发送/i.test(getText(300))) return { ok: true };
    return { ok: false, error: "发送失败" };
  }

  // ========== 步骤 3: 打开链接 ==========
  async function stepOpenLink(link) {
    clearZoCookies();
    setTimeout(function() { location.href = link; }, 200);
    return { ok: true };
  }

  // ========== Turnstile 主动检测步骤 ==========
  async function stepTurnstileCheck() {
    const tsState = checkTurnstileState();
    if (tsState === 'pending') {
      await tryClickCaptcha();
      return { ok: true, done: false, stage: "turnstile_solving" };
    }
    if (tsState === 'ready') {
      return { ok: true, done: false, stage: "turnstile_ready" };
    }
    return { ok: true, done: false, stage: "no_turnstile" };
  }

  // ========== 验证页面单次识别/处理 ==========
  // 只处理当前页面一次并立即返回；长时间等待由 background 轮询，避免误判和 BFCache 断 port。
  async function stepVerifyTick() {
    const url = location.href;
    const txt = getText(1000);

    // 已到达 profile/handle 设置页面，验证完成（新注册流程）
    // 英文+中文
    if (/set up your profile|choose your handle|display name|设置.*个人资料|设置.*资料|选择.*用户名|选择.*昵称|显示名称/i.test(txt)) {
      return { ok: true, done: true, stage: "profile", url: location.href };
    }

    // 检测已注册邮箱：直接跳到主界面（xxx.zo.computer 而非 www.zo.computer）
    var hostname = '';
    try { hostname = location.hostname.toLowerCase(); } catch (e) {}
    var isSubdomain = hostname && hostname.endsWith('.zo.computer') && hostname !== 'www.zo.computer' && hostname !== 'zo.computer';
    // 英文+中文：主界面关键词
    var hasMainUI = /dashboard|welcome|explore|home|zo space|files|chat|automations|your conversations|仪表盘|欢迎|探索|首页|文件|聊天|自动化|对话/i.test(txt);
    if (isSubdomain && hasMainUI && !/booting|starting|loading|启动中|加载|%/i.test(txt)) {
      return { ok: true, done: true, stage: "registered", url: location.href, text: "邮箱已注册过，直接进入主界面" };
    }

    // URL 离开 verify/email-login，且不是普通 signup 页，才按跳转完成处理
    if (/zo\.computer/i.test(url) && !/\/email-login\/verify|\/verify|\/signup/.test(url)) {
      return { ok: true, done: true, stage: "left_verify", url: location.href };
    }

    // 英文+中文：链接失效
    if (/invalid|expired|已失效|已过期|无效/i.test(txt) && !/redirecting|verif|重定向|验证/i.test(txt)) {
      return { ok: false, done: false, error: "链接已失效", stage: "invalid", url: location.href };
    }

    // 继续在浏览器中 / 浏览器验证 Continue
    // 英文+中文
    if (/Continue in browser|Complete the browser check to continue|在浏览器中继续|在浏览器中完成验证|浏览器验证/i.test(txt)) {
      clickBtn(/Continue in browser|在浏览器中继续/i) || clickBtn(/^Continue$|^继续$/i);
      await sleep(1000);
      return { ok: true, done: false, stage: "clicked_continue", url: location.href };
    }

    // ★ Turnstile 主动检测：如果页面有未完成的 Turnstile 挑战，主动获取令牌并填入
    const tsState = checkTurnstileState();
    if (tsState === 'pending') {
      await tryClickCaptcha();
      return { ok: true, done: false, stage: "turnstile_solving", url: location.href };
    }
    if (tsState === 'ready') {
      // 令牌已就绪，等待页面自然跳转
      return { ok: true, done: false, stage: "turnstile_ready", url: location.href };
    }

    // 英文+中文：重定向中
    if (/redirecting|重定向|正在跳转|正在重定向/i.test(txt)) {
      return { ok: true, done: false, stage: "redirecting", url: location.href };
    }

    // 尝试点击验证码/浏览器校验
    await tryClickCaptcha();
    return { ok: true, done: false, stage: "waiting_verify", url: location.href, text: txt.substring(0, 120).replace(/\n/g, " ") };
  }

  // 兼容旧消息名：不再长等待，只执行一次 verify tick
  async function stepWaitVerify() {
    return await stepVerifyTick();
  }

  // ========== Cloudflare Turnstile 处理 (v3 增强版) ==========
  // 检测 Turnstile 状态：not-found / pending / ready
  function checkTurnstileState() {
    try {
      // 检查隐藏 input
      const input = document.querySelector('input[name="cf-turnstile-response"]');
      if (input && input.value && input.value.length > 20) return 'ready';
      if (input) return 'pending';
      // 检查 data-success 属性
      const successEl = document.querySelector('.cf-turnstile[data-success="true"]');
      if (successEl) return 'ready';
      // 检查 Turnstile iframe 是否存在
      const hasIframe = !!document.querySelector('iframe[src*="challenges.cloudflare"], iframe[src*="turnstile"]');
      if (hasIframe) return 'pending';
      return 'not-found';
    } catch (e) {
      return 'not-found';
    }
  }
  
  // 核心策略：4级递进式 Turnstile 突破
  async function tryClickCaptcha() {
    // ---- 第1优先级：使用 turnstile JS API 获取令牌（无点击，最干净）----
    const tsToken = await getTurnstileToken();
    if (tsToken) {
      const responseInput = document.querySelector('input[name="cf-turnstile-response"]');
      if (responseInput) {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        setter.call(responseInput, tsToken);
        responseInput.dispatchEvent(new Event('change', { bubbles: true }));
        return;
      }
    }
  
    // ---- 第2优先级：坐标式鼠标模拟点击 Turnstile checkbox（最可靠）----
    const coordClicked = await clickTurnstileByCoordinates();
    if (coordClicked) {
      // 等待验证完成
      for (let w = 0; w < 15; w++) {
        await sleep(2000);
        if (checkTurnstileState() === 'ready') return;
      }
    }
  
    // ---- 第3优先级：Shadow DOM 穿透 + iframe 内部注入 ----
    await clickTurnstileIframe();
    await sleep(2000);
    if (checkTurnstileState() === 'ready') return;
  
    // ---- 第4优先级：普通 checkbox（Terms 等非 Turnstile 场景）----
    for (const cb of document.querySelectorAll('input[type=checkbox]')) {
      if (!cb.checked && cb.offsetParent !== null) {
        try { cb.click(); await sleep(500); } catch (e) {}
      }
    }
  }
  
  // 使用 turnstile JS API 获取令牌（grok-register 验证过的高效方案）
  async function getTurnstileToken() {
    try {
      if (typeof turnstile !== 'undefined') {
        // 先尝试 execute（触发 non-interactive 模式验证）
        try { turnstile.execute(); } catch (e) {}
        // 重置并重新获取
        try { turnstile.reset(); } catch (e) {}
        await sleep(500);
        // 循环尝试获取令牌
        for (let i = 0; i < 20; i++) {
          try {
            const res = turnstile.getResponse();
            if (res && res.length > 20) return res;
          } catch (e) {}
          // 每隔几秒再次 reset
          if (i === 5 || i === 10) {
            try { turnstile.reset(); } catch (e2) {}
            try { turnstile.execute(); } catch (e3) {}
          }
          await sleep(800);
        }
      }
    } catch (e) {}
  
    // 从隐藏字段读取（可能已经自动完成）
    try {
      const input = document.querySelector('input[name="cf-turnstile-response"]');
      if (input && input.value && input.value.length > 20) return input.value;
    } catch (e) {}
  
    return null;
  }
  
  // ★ 新增：坐标式鼠标模拟点击 Turnstile checkbox（v3 核心新增方法）
  // 原理：找到 Turnstile iframe 在页面上的位置，计算 checkbox 的坐标，
  // 然后模拟人类鼠标移动轨迹 + 点击。Turnstile 会检测鼠标移动轨迹。
  async function clickTurnstileByCoordinates() {
    try {
      // 查找 Turnstile widget 的位置
      let widgetRect = null;
  
      // 方法A: 通过 iframe 查找
      const iframes = document.querySelectorAll('iframe');
      for (const iframe of iframes) {
        const src = (iframe.src || '').toLowerCase();
        if (src.includes('challenges.cloudflare') || src.includes('turnstile')) {
          const rect = iframe.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) {
            widgetRect = rect;
            break;
          }
        }
      }
  
      // 方法B: 通过 cf-turnstile 容器查找
      if (!widgetRect) {
        const containers = document.querySelectorAll('.cf-turnstile, [data-sitekey]');
        for (const c of containers) {
          const rect = c.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) {
            widgetRect = rect;
            break;
          }
        }
      }
  
      if (!widgetRect) return false;
  
      // Turnstile checkbox 在 widget 左侧约 28-32px，垂直居中
      const clickX = widgetRect.x + 30;
      const clickY = widgetRect.y + widgetRect.height / 2;
  
      // 模拟人类鼠标移动轨迹：从随机起点 → 中间点 → 目标点
      const startX = Math.max(0, clickX - 100 - Math.random() * 200);
      const startY = Math.max(0, clickY - 50 - Math.random() * 150);
      const midX = (startX + clickX) / 2 + (Math.random() - 0.5) * 60;
      const midY = (startY + clickY) / 2 + (Math.random() - 0.5) * 40;
  
      // Step 1: 移动到起点
      document.dispatchEvent(new MouseEvent('mousemove', {
        bubbles: true, clientX: startX, clientY: startY,
        screenX: startX + 120, screenY: startY + 80
      }));
      await sleep(80 + Math.random() * 120);
  
      // Step 2: 移动到中间点
      document.dispatchEvent(new MouseEvent('mousemove', {
        bubbles: true, clientX: midX, clientY: midY,
        screenX: midX + 120, screenY: midY + 80
      }));
      await sleep(60 + Math.random() * 100);
  
      // Step 3: 移动到目标点
      document.dispatchEvent(new MouseEvent('mousemove', {
        bubbles: true, clientX: clickX, clientY: clickY,
        screenX: clickX + 120, screenY: clickY + 80
      }));
      await sleep(100 + Math.random() * 200);
  
      // Step 4: 按下 → 释放 → 点击
      const commonOpts = {
        bubbles: true, cancelable: true,
        clientX: clickX, clientY: clickY,
        screenX: clickX + 120 + Math.floor(Math.random() * 4),
        screenY: clickY + 80 + Math.floor(Math.random() * 4),
        button: 0
      };
      document.dispatchEvent(new MouseEvent('mousedown', commonOpts));
      await sleep(40 + Math.random() * 80);
      document.dispatchEvent(new MouseEvent('mouseup', commonOpts));
      document.dispatchEvent(new MouseEvent('click', commonOpts));
  
      // 同时发送 PointerEvent（Turnstile 也会检测）
      if (typeof PointerEvent !== 'undefined') {
        document.dispatchEvent(new PointerEvent('pointerdown', { ...commonOpts, pointerId: 1, pointerType: 'mouse' }));
        document.dispatchEvent(new PointerEvent('pointerup', { ...commonOpts, pointerId: 1, pointerType: 'mouse' }));
      }
  
      return true;
    } catch (e) {
      return false;
    }
  }
  
  // Shadow DOM 穿透 + iframe 内部 screenX/screenY 二次注入
  async function clickTurnstileIframe() {
    try {
      const turnstileInput = document.querySelector('input[name="cf-turnstile-response"]');
      if (!turnstileInput) return;
  
      const parent = turnstileInput.parentElement;
      if (!parent) return;
      const shadowRoot = parent.shadowRoot;
      if (!shadowRoot) return;
      const iframe = shadowRoot.querySelector('iframe');
      if (!iframe) return;
  
      // 在 iframe 内部二次注入 screenX/screenY 劫持
      try {
        const offsetX = Math.floor(Math.random() * 120) + 80;
        const offsetY = Math.floor(Math.random() * 90) + 60;
        iframe.contentWindow.eval(
          'Object.defineProperty(MouseEvent.prototype, "screenX", { get: function() { return (this.clientX||0) + ' + offsetX + '; }, configurable: true });' +
          'Object.defineProperty(MouseEvent.prototype, "screenY", { get: function() { return (this.clientY||0) + ' + offsetY + '; }, configurable: true });' +
          'Object.defineProperty(PointerEvent.prototype, "screenX", { get: function() { return (this.clientX||0) + ' + offsetX + '; }, configurable: true });' +
          'Object.defineProperty(PointerEvent.prototype, "screenY", { get: function() { return (this.clientY||0) + ' + offsetY + '; }, configurable: true });' +
          'Object.defineProperty(navigator, "webdriver", { get: function() { return undefined; } });'
        );
      } catch (e) {
        // 跨域 iframe 无法访问 contentWindow，扩展的 all_frames 注入已覆盖
      }
  
      // 点击 Turnstile checkbox（通过 Shadow DOM）
      try {
        const iframeBody = iframe.contentDocument ? iframe.contentDocument.body : null;
        if (iframeBody) {
          const checkbox = iframeBody.querySelector('input[type=checkbox]') ||
                           (iframeBody.shadowRoot ? iframeBody.shadowRoot.querySelector('input') : null);
          if (checkbox) {
            checkbox.click();
            await sleep(1000);
            return;
          }
        }
      } catch (e) {}
  
      // 备选：直接点击 shadow_root 内的 input
      try {
        const innerInput = shadowRoot.querySelector('input');
        if (innerInput) {
          innerInput.click();
          await sleep(1000);
        }
      } catch (e) {}
    } catch (e) {}
  }

  // ========== 步骤 5: 设置 Handle + 点击 Continue ==========
  async function stepSetHandle(email) {
    const prefix = email.split("@")[0].replace(/[^a-zA-Z0-9]/g, "");
    const handle = prefix.substring(0, Math.min(8, Math.max(3, prefix.length)));

    await sleep(2000);

    // 找 handle 输入框 — 英文+中文 placeholder/label
    let handleInput = document.querySelector("input[placeholder='you']") ||
                      document.querySelector("input[name='handle']") ||
                      document.querySelector("input[placeholder*='handle']") ||
                      document.querySelector("input[placeholder*='用户名']") ||
                      document.querySelector("input[placeholder*='昵称']");
    if (!handleInput) {
      for (const inp of document.querySelectorAll("input[type=text], input:not([type])")) {
        const ph = (inp.placeholder || "").toLowerCase();
        const label = inp.closest("label") || inp.parentElement;
        const labelText = (label ? label.textContent : "").toLowerCase();
        if (/handle|username|choose|用户名|昵称|选择/i.test(ph + " " + labelText)) { handleInput = inp; break; }
      }
    }
    if (handleInput) {
      handleInput.focus();
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
      setter.call(handleInput, handle);
      handleInput.dispatchEvent(new Event("input", { bubbles: true }));
      handleInput.dispatchEvent(new Event("change", { bubbles: true }));
      await sleep(1000);
    }

    // 找 display name 输入框 — 英文+中文
    let nameInput = null;
    for (const inp of document.querySelectorAll("input[type=text], input:not([type])")) {
      const ph = (inp.placeholder || "").toLowerCase();
      const label = inp.closest("label") || inp.parentElement;
      const labelText = (label ? label.textContent : "").toLowerCase();
      if (/display\s*name|your\s*name|显示名称|你的名字|昵称|姓名/i.test(ph + " " + labelText)) { nameInput = inp; break; }
    }
    if (!nameInput && !handleInput) {
      const allText = document.querySelectorAll("input[type=text], input:not([type])");
      if (allText.length >= 2) nameInput = allText[1];
    }
    if (nameInput && nameInput !== handleInput) {
      nameInput.focus();
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
      setter.call(nameInput, handle);
      nameInput.dispatchEvent(new Event("input", { bubbles: true }));
      nameInput.dispatchEvent(new Event("change", { bubbles: true }));
      await sleep(500);
    }

    // 点击 Continue / 继续
    clickBtn(/^Continue$|^继续$/i);
    await sleep(3000);

    return { ok: true, handle };
  }

  // ========== Onboarding 单次识别/处理 ==========
  // 只处理当前页面一次并立即返回；长时间等待由 background 轮询，避免 BFCache 关闭消息通道。
  async function stepOnboardingTick() {
    const txt = getText(1000);
    const lower = txt.toLowerCase();
    const urlNow = location.href.toLowerCase();
    // 只匹配 www.zo.computer 或 zo.computer 的 signup 流程，不匹配 xxx.zo.computer 子域名
    const hostname = location.hostname.toLowerCase();
    const isSubdomain = hostname.endsWith('.zo.computer') && hostname !== 'www.zo.computer' && hostname !== 'zo.computer';
    const stillOnSignupFlow = !isSubdomain && /\/signup|\/email-login|\/verify/.test(urlNow);

    // 已注册邮箱：已到达主界面（xxx.zo.computer 子域名）
    // 英文+中文关键词
    if (isSubdomain &&
        (/dashboard|welcome|explore|home|仪表盘|欢迎|探索|首页/i.test(lower) ||
         (/zo space/i.test(txt) && (/files|文件/i.test(txt)) && (/chat|聊天/i.test(txt))) ||
         /your conversations|start a new conversation|你的对话|开始新对话/i.test(txt)) &&
        !/booting|starting|loading|启动中|加载|%/i.test(txt)) {
      return { ok: true, done: true, stage: "registered", url: location.href, text: "邮箱已注册过，直接进入主界面" };
    }

    // 到达真正主界面：不能仍在 signup/email-login/verify 流程里。
    // 英文+中文关键词
    if (!stillOnSignupFlow &&
        (/dashboard|welcome\s*back|explore|home|仪表盘|欢迎回来|探索|首页/i.test(lower) ||
         (/zo space/i.test(txt) && (/files|文件/i.test(txt)) && (/chat|聊天/i.test(txt))) ||
         /your conversations|start a new conversation|你的对话|开始新对话/i.test(txt)) &&
        !/booting|starting|loading|启动中|加载|%/i.test(txt)) {
      return { ok: true, done: true, stage: "main", url: location.href };
    }

    // Go to your Zo / Get started — 英文+中文
    if (/go to your zo|get started|get started with|前往你的Zo|前往你的.*Zo|开始使用|开始体验/i.test(txt)) {
      clickBtn(/go to your zo|get\s*started|前往你的Zo|前往你的.*Zo|开始使用|开始体验/i);
      await sleep(1000);
      return { ok: true, done: false, stage: "clicked_go_to_zo", url: location.href };
    }

    // 手机号验证 — 跳过 — 英文+中文
    if (/verify your phone|phone number|add your phone|enter your phone|mobile number|验证手机号|手机号码|添加手机号|输入手机号|手机验证/i.test(txt)) {
      clickBtn(/skip|not now|maybe later|skip for now|跳过|稍后|暂时跳过/i) || clickBtn(/^Continue$|^继续$/i);
      await sleep(1000);
      return { ok: true, done: false, stage: "skip_phone", url: location.href };
    }

    // Checkbox 页 (Terms of Use + 18 years) — 英文+中文
    if (/terms of use|18.*years|agree|使用条款|服务条款|年满.*18|同意|隐私政策/i.test(txt) ||
        (document.querySelectorAll('input[type=checkbox]:not(:checked)').length > 0 && /terms|agree|policy|条款|同意|政策/i.test(txt))) {
      for (const cb of document.querySelectorAll('input[type=checkbox]')) {
        if (!cb.checked && cb.offsetParent !== null) {
          try { cb.click(); await sleep(500); } catch (e) {
            const label = cb.closest("label") || cb.parentElement;
            if (label) try { label.click(); } catch (e2) {}
          }
        }
      }
      await sleep(500);
      clickBtn(/skip\s*for\s*now|skip|暂时跳过|跳过/i) || clickBtn(/^Continue$|^继续$/i);
      await sleep(1000);
      return { ok: true, done: false, stage: "checkbox_skip", url: location.href };
    }

    // 问卷/偏好选择（常在加载过程中出现）
    if (isSurveyPage(lower)) {
      await handleSurvey();
      return { ok: true, done: false, stage: "survey", url: location.href };
    }

    // Profile 设置页兜底，不直接判成功 — 英文+中文
    if (/set up your profile|choose your handle|display name|设置.*个人资料|设置.*资料|选择.*用户名|选择.*昵称|显示名称/i.test(txt)) {
      clickBtn(/^Continue$|^继续$/i) || clickBtn(/skip\s*for\s*now|skip|暂时跳过|跳过/i);
      await sleep(1000);
      return { ok: true, done: false, stage: "profile_fallback", url: location.href };
    }

    // 加载中，继续等待 — 英文+中文
    if (/booting|starting|loading|%|preparing|creating|启动中|加载中|准备中|创建中/i.test(txt)) {
      return { ok: true, done: false, stage: "loading", url: location.href };
    }

    // 出错 — 英文+中文
    if (/invalid|expired|something went wrong|已失效|已过期|出了点问题|发生错误/i.test(txt)) {
      return { ok: false, done: false, error: "页面提示失败", stage: "error", url: location.href };
    }

    return { ok: true, done: false, stage: "unknown", url: location.href, text: txt.substring(0, 120).replace(/\n/g, " ") };
  }

  // 兼容旧消息名：不再长等待，只执行一次 tick
  async function stepWaitBoot() {
    return await stepOnboardingTick();
  }

  // 识别问卷/偏好页面 — 英文+中文
  function isSurveyPage(lower) {
    return /what.*(interest|prefer|looking|want|use)/i.test(lower) ||
           /select.*(interest|preference|topic|option)/i.test(lower) ||
           /choose.*(interest|preference|category)/i.test(lower) ||
           /how.*(use|plan|intend)/i.test(lower) ||
           /tell us/i.test(lower) ||
           /pick.*(up to|some|a few)/i.test(lower) ||
           /什么.*兴趣|选择.*偏好|你.*喜欢|你.*感兴趣|如何.*使用|告诉我们|挑选/i.test(lower);
  }

  // 处理问卷页面 — 随机选一个然后继续/跳过 — 英文+中文
  async function handleSurvey() {
    // 随机点一个选项
    const options = document.querySelectorAll('button, div[role=button], label, .option, [class*=option], [class*=chip]');
    const visible = Array.from(options).filter(el => el.offsetParent !== null && el.textContent.trim().length > 0);
    if (visible.length > 0) {
      const idx = Math.floor(Math.random() * visible.length);
      visible[idx].click();
      await sleep(1500);
    }
    // 点击 Continue / Next / Skip / Done + 继续 / 下一步 / 跳过 / 完成 / 提交
    clickBtn(/continue|next|skip|done|submit|继续|下一步|跳过|完成|提交/i);
    await sleep(2000);
  }

  // ===== 保活：查找聊天输入框并发送消息 =====
  async function stepKeepaliveSend(text) {
    // 安全检查：确认在 ZO 主界面（英文+中文）
    var hostname = '';
    try { hostname = location.hostname.toLowerCase(); } catch (e) {}
    var isSubdomain = hostname && hostname.endsWith('.zo.computer') && hostname !== 'www.zo.computer' && hostname !== 'zo.computer';
    if (!isSubdomain) {
      return { ok: false, error: '不在 ZO 主界面，当前: ' + hostname };
    }
    // 额外验证：页面确实有聊天/主界面内容（英文+中文）
    var pageText = getText(500);
    var hasChatUI = /chat|message|conversation|files|dashboard|explore|聊天|消息|对话|文件|仪表盘|探索/i.test(pageText);
    if (!hasChatUI) {
      return { ok: false, error: '当前页面非聊天主界面，可能还在注册/验证流程中' };
    }
    console.log('[ZO保活] 当前页面: ' + location.href);

    // 查找聊天输入框
    var chatInput = findChatInput();
    if (!chatInput) {
      // 最后手段：打印所有可交互元素供调试
      var allInputs = document.querySelectorAll('input, textarea, [contenteditable], [role=textbox]');
      console.log('[ZO保活] 找不到聊天框，页面上可输入元素:');
      for (var d = 0; d < allInputs.length; d++) {
        var el = allInputs[d];
        console.log('  [' + d + '] tag=' + el.tagName + ' type=' + (el.type||'') + ' placeholder=' + (el.placeholder||'') + ' role=' + (el.getAttribute('role')||'') + ' ce=' + el.contentEditable + ' class=' + (el.className||'').substring(0,60));
      }
      return { ok: false, error: '找不到聊天输入框 (页面上 ' + allInputs.length + ' 个可输入元素)' };
    }
    console.log('[ZO保活] 找到输入框: tag=' + chatInput.tagName + ' class=' + (chatInput.className||'').substring(0,60));

    // 聚焦并输入文本
    chatInput.focus();
    await sleep(500);

    var isContentEditable = chatInput.contentEditable === 'true';
    var isTextarea = chatInput.tagName === 'TEXTAREA';
    var isInput = chatInput.tagName === 'INPUT';

    if (isContentEditable) {
      // contenteditable：清空后用 execCommand 插入
      chatInput.innerHTML = '';
      document.execCommand('insertText', false, text);
      chatInput.dispatchEvent(new Event('input', { bubbles: true }));
    } else if (isTextarea || isInput) {
      var proto = isTextarea ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      var setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
      setter.call(chatInput, text);
      chatInput.dispatchEvent(new Event('input', { bubbles: true }));
      chatInput.dispatchEvent(new Event('change', { bubbles: true }));
    }
    await sleep(800);

    // 尝试多种方式发送
    var sent = false;

    // 方法1：Enter 键
    var enterOpts = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true };
    chatInput.dispatchEvent(new KeyboardEvent('keydown', enterOpts));
    chatInput.dispatchEvent(new KeyboardEvent('keyup', enterOpts));
    await sleep(2000);
    sent = checkSent(chatInput, text, isContentEditable);
    if (sent) { console.log('[ZO保活] Enter 发送成功'); return { ok: true, text: text }; }

    // 方法2：点击发送按钮（广泛搜索）
    var sendBtn = findSendButton();
    if (sendBtn) {
      console.log('[ZO保活] 找到发送按钮，点击...');
      forceClick(sendBtn);
      await sleep(2000);
      sent = checkSent(chatInput, text, isContentEditable);
      if (sent) { console.log('[ZO保活] 按钮发送成功'); return { ok: true, text: text }; }
    }

    // 方法3：Ctrl+Enter（某些聊天用这个发送）
    var ctrlEnterOpts = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true, ctrlKey: true };
    chatInput.dispatchEvent(new KeyboardEvent('keydown', ctrlEnterOpts));
    await sleep(2000);
    sent = checkSent(chatInput, text, isContentEditable);
    if (sent) { console.log('[ZO保活] Ctrl+Enter 发送成功'); return { ok: true, text: text }; }

    // 方法4：表单提交
    var form = chatInput.closest('form');
    if (form) {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      await sleep(2000);
      sent = checkSent(chatInput, text, isContentEditable);
      if (sent) { console.log('[ZO保活] 表单提交成功'); return { ok: true, text: text }; }
    }

    console.log('[ZO保活] 所有发送方式均失败');
    return { ok: false, error: '发送失败，尝试了 Enter/按钮/Ctrl+Enter/表单' };
  }

  function checkSent(el, text, isContentEditable) {
    if (isContentEditable) {
      var val = (el.innerText || el.textContent || '').trim();
      return val === '' || val !== text.trim();
    }
    var val2 = (el.value || '').trim();
    return val2 === '' || val2 !== text.trim();
  }

  // 查找聊天输入框 — 英文+中文
  function findChatInput() {
    // 策略1：精确匹配 placeholder / aria-label / data-testid
    var selectors = [
      'textarea[placeholder*="message" i]', 'textarea[placeholder*="消息" i]',
      'textarea[placeholder*="chat" i]', 'textarea[placeholder*="ask" i]',
      'textarea[placeholder*="输入" i]', 'textarea[placeholder*="type" i]',
      'textarea[placeholder*="send" i]', 'textarea[placeholder*="发送" i]',
      'textarea[placeholder*="聊天" i]', 'textarea[placeholder*="对话" i]',
      'textarea[placeholder*="提问" i]',
      'textarea[aria-label*="message" i]', 'textarea[aria-label*="chat" i]',
      'textarea[aria-label*="input" i]', 'textarea[aria-label*="send" i]',
      'textarea[aria-label*="消息" i]', 'textarea[aria-label*="聊天" i]',
      'textarea[aria-label*="输入" i]', 'textarea[aria-label*="发送" i]',
      '[role="textbox"][contenteditable="true"]',
      '[contenteditable="true"][aria-label*="message" i]',
      '[contenteditable="true"][aria-label*="消息" i]',
      '[contenteditable="true"][data-testid*="input"]',
      '[contenteditable="true"][data-testid*="chat"]',
      'textarea[data-testid*="input"]', 'textarea[data-testid*="chat"]',
      'textarea[data-testid*="message"]',
      'div[role="textbox"][contenteditable]'
    ];
    for (var i = 0; i < selectors.length; i++) {
      var el = document.querySelector(selectors[i]);
      if (el && isVisible(el)) return el;
    }
    // 策略2：任何可见的 textarea（排除只读/禁用）
    var textareas = document.querySelectorAll('textarea');
    for (var j = 0; j < textareas.length; j++) {
      if (isVisible(textareas[j]) && !textareas[j].readOnly && !textareas[j].disabled) return textareas[j];
    }
    // 策略3：任何 contenteditable=true 的元素（排除太小的）
    var editables = document.querySelectorAll('[contenteditable="true"]');
    for (var k = 0; k < editables.length; k++) {
      var rect = editables[k].getBoundingClientRect();
      if (rect.width > 80 && rect.height > 15 && editables[k].offsetParent !== null) return editables[k];
    }
    // 策略4：ProseMirror / TipTap 编辑器（常见于现代聊天 UI）
    var prosemirror = document.querySelector('.ProseMirror, .tiptap, [class*="editor"][contenteditable], [class*="input"][contenteditable]');
    if (prosemirror && isVisible(prosemirror)) return prosemirror;
    // 策略5：Shadow DOM 内查找
    var allElements = document.querySelectorAll('*');
    for (var m = 0; m < allElements.length; m++) {
      var shadow = allElements[m].shadowRoot;
      if (!shadow) continue;
      var inner = shadow.querySelector('textarea, [contenteditable="true"], [role="textbox"]');
      if (inner) {
        var r = inner.getBoundingClientRect();
        if (r.width > 80 && r.height > 15) return inner;
      }
    }
    return null;
  }

  // 查找发送按钮 — 英文+中文
  function findSendButton() {
    var selectors = [
      'button[aria-label*="send" i]', 'button[aria-label*="发送" i]',
      'button[title*="send" i]', 'button[title*="发送" i]',
      'button[type="submit"]',
      '[data-testid*="send"]', '[data-testid*="submit"]',
      'button[class*="send" i]', 'button[class*="submit" i]',
      'button[class*="发送" i]'
    ];
    for (var i = 0; i < selectors.length; i++) {
      var btn = document.querySelector(selectors[i]);
      if (btn && isVisible(btn) && !btn.disabled) return btn;
    }
    // 兜底：找含有箭头图标的按钮（发送按钮常见样式）
    var allBtns = document.querySelectorAll('button');
    for (var j = 0; j < allBtns.length; j++) {
      var b = allBtns[j];
      if (!isVisible(b) || b.disabled) continue;
      var svg = b.querySelector('svg');
      var ariaLabel = (b.getAttribute('aria-label') || '').toLowerCase();
      var title = (b.title || '').toLowerCase();
      var cls = (b.className || '').toLowerCase();
      if (/send|submit|arrow.*up|发送|提交/i.test(ariaLabel + ' ' + title + ' ' + cls)) return b;
    }
    return null;
  }

  // ========== 消息 ==========
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === "ping") {
      sendResponse({ ok: true, url: location.href });
      return false;
    }
    if (msg.type === "zo_step") {
      (async () => {
        try {
          let result;
          switch (msg.step) {
            case "click_email_btn": result = await stepClickEmailBtn(); break;
            case "fill_email": result = await stepFillEmail(msg.email); break;
            case "open_link": result = await stepOpenLink(msg.link); break;
            case "wait_verify": result = await stepWaitVerify(); break;
            case "verify_tick": result = await stepVerifyTick(); break;
            case "turnstile_check": result = await stepTurnstileCheck(); break;
            case "set_handle": result = await stepSetHandle(msg.email || "user"); break;
            case "wait_boot": result = await stepWaitBoot(); break;
            case "onboarding_tick": result = await stepOnboardingTick(); break;
            case "keepalive_send": result = await stepKeepaliveSend(msg.text || 'hello'); break;
            default: result = { ok: false, error: "未知步骤: " + msg.step };
          }
          sendResponse(result);
        } catch (e) {
          sendResponse({ ok: false, error: e.message });
        }
      })();
      return true;
    }
  });

  try { chrome.runtime.sendMessage({ type: "content_ready", url: location.href }).catch(() => {}); } catch (e) {}
})();

