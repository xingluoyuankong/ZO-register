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

    const emailButtonPattern = /email\s*(me\s*)?(a\s*)?(sign[-\s]*up|login|log\s*in)?\s*link|sign[-\s]*up\s*link|continue\s*with\s*email|use\s*email|email/i;
    for (let i = 0; i < 20; i++) {
      const txt = getText(1000);
      if (clickBtn(emailButtonPattern)) {
        await sleep(2000);
        return { ok: true };
      }
      if (/check your email|login link|we sent/i.test(txt)) {
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
    clickBtn(/^Continue$/i);
    await sleep(3000);
    const txt = getText(400);
    if (/check your email|login link|we sent/i.test(txt)) return { ok: true };
    clickBtn(/^Continue$/i);
    await sleep(3000);
    if (/check your email|login link|we sent/i.test(getText(300))) return { ok: true };
    return { ok: false, error: "发送失败" };
  }

  // ========== 步骤 3: 打开链接 ==========
  async function stepOpenLink(link) {
    clearZoCookies();
    setTimeout(function() { location.href = link; }, 200);
    return { ok: true };
  }

  // ========== 验证页面单次识别/处理 ==========
  // 只处理当前页面一次并立即返回；长时间等待由 background 轮询，避免误判和 BFCache 断 port。
  async function stepVerifyTick() {
    const url = location.href;
    const txt = getText(1000);

    // 已到达 profile/handle 设置页面，验证完成（新注册流程）
    if (/set up your profile|choose your handle|display name/i.test(txt)) {
      return { ok: true, done: true, stage: "profile", url: location.href };
    }

    // 检测已注册邮箱：直接跳到主界面（xxx.zo.computer 而非 www.zo.computer）
    var hostname = '';
    try { hostname = location.hostname.toLowerCase(); } catch (e) {}
    var isSubdomain = hostname && hostname.endsWith('.zo.computer') && hostname !== 'www.zo.computer' && hostname !== 'zo.computer';
    var hasMainUI = /dashboard|welcome|explore|home|zo space|files|chat|automations|your conversations/i.test(txt);
    if (isSubdomain && hasMainUI && !/booting|starting|loading|%/i.test(txt)) {
      return { ok: true, done: true, stage: "registered", url: location.href, text: "邮箱已注册过，直接进入主界面" };
    }

    // URL 离开 verify/email-login，且不是普通 signup 页，才按跳转完成处理
    if (/zo\.computer/i.test(url) && !/\/email-login\/verify|\/verify|\/signup/.test(url)) {
      return { ok: true, done: true, stage: "left_verify", url: location.href };
    }

    if (/invalid|expired/i.test(txt) && !/redirecting|verif/i.test(txt)) {
      return { ok: false, done: false, error: "链接已失效", stage: "invalid", url: location.href };
    }

    // 继续在浏览器中 / 浏览器验证 Continue
    if (/Continue in browser/i.test(txt) || /Complete the browser check to continue/i.test(txt)) {
      clickBtn(/Continue in browser/i) || clickBtn(/^Continue$/i);
      await sleep(1000);
      return { ok: true, done: false, stage: "clicked_continue", url: location.href };
    }

    if (/redirecting/i.test(txt)) {
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

  async function tryClickCaptcha() {
    // 方法1: 点击页面上所有未勾选的 checkbox
    for (const cb of document.querySelectorAll('input[type=checkbox]')) {
      if (!cb.checked && cb.offsetParent !== null) {
        try { cb.click(); await sleep(500); } catch (e) {}
        try { cb.dispatchEvent(new MouseEvent('click', { bubbles: true })); } catch (e) {}
      }
    }

    // 方法2: 找 hCaptcha/reCAPTCHA 的 checkbox（通过 label/aria）
    for (const label of document.querySelectorAll('label, [role=checkbox], [aria-checked]')) {
      if (label.offsetParent !== null) {
        try { label.click(); await sleep(300); } catch (e) {}
      }
    }

    // 方法3: 找验证码 iframe 并点击其内部区域
    for (const frame of document.querySelectorAll('iframe')) {
      const src = (frame.src || '').toLowerCase();
      const title = (frame.title || '').toLowerCase();
      if (src.includes('hcaptcha') || src.includes('recaptcha') || src.includes('captcha') ||
          title.includes('captcha') || title.includes('hcaptcha') || title.includes('recaptcha')) {
        try {
          const rect = frame.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) {
            // 点击 iframe 左侧 1/4 处（checkbox 通常在左边）
            const x = rect.left + rect.width * 0.15;
            const y = rect.top + rect.height * 0.5;
            const evt = new MouseEvent('click', {
              bubbles: true, cancelable: true,
              clientX: x, clientY: y,
              screenX: x + window.screenX, screenY: y + window.screenY
            });
            frame.dispatchEvent(evt);
            // 也尝试点击父元素
            if (frame.parentElement) frame.parentElement.click();
            await sleep(500);
          }
        } catch (e) {}
      }
    }

    // 方法4: 找验证码容器并点击
    var sels = [
      '#hcaptcha-container', '.h-captcha', '[data-hcaptcha-widget-id]',
      '#recaptcha-container', '.g-recaptcha', '[data-sitekey]',
      '[class*="captcha"]', '[id*="captcha"]',
      '[class*="challenge"]', '[id*="challenge"]'
    ];
    for (const sel of sels) {
      const el = document.querySelector(sel);
      if (el && el.offsetParent !== null) {
        try { el.click(); await sleep(300); } catch (e) {}
      }
    }

    // 方法5: 找所有可点击的元素（button/a/div）包含 captcha 相关文字
    clickBtn(/verify|captcha|我不是机器人|人机验证|我不是|robot|human/i);
  }

  // ========== 步骤 5: 设置 Handle + 点击 Continue ==========
  async function stepSetHandle(email) {
    const prefix = email.split("@")[0].replace(/[^a-zA-Z0-9]/g, "");
    const handle = prefix.substring(0, Math.min(8, Math.max(3, prefix.length)));

    await sleep(2000);

    // 找 handle 输入框
    let handleInput = document.querySelector("input[placeholder='you']") ||
                      document.querySelector("input[name='handle']") ||
                      document.querySelector("input[placeholder*='handle']");
    if (!handleInput) {
      for (const inp of document.querySelectorAll("input[type=text], input:not([type])")) {
        const ph = (inp.placeholder || "").toLowerCase();
        const label = inp.closest("label") || inp.parentElement;
        const labelText = (label ? label.textContent : "").toLowerCase();
        if (/handle|username|choose/i.test(ph + " " + labelText)) { handleInput = inp; break; }
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

    // 找 display name 输入框
    let nameInput = null;
    for (const inp of document.querySelectorAll("input[type=text], input:not([type])")) {
      const ph = (inp.placeholder || "").toLowerCase();
      const label = inp.closest("label") || inp.parentElement;
      const labelText = (label ? label.textContent : "").toLowerCase();
      if (/display\s*name|your\s*name/i.test(ph + " " + labelText)) { nameInput = inp; break; }
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

    // 点击 Continue
    clickBtn(/^Continue$/i);
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
    if (isSubdomain &&
        (/dashboard|welcome|explore|home/i.test(lower) ||
         (/zo space/i.test(txt) && /files/i.test(txt) && /chat/i.test(txt)) ||
         /your conversations|start a new conversation/i.test(txt)) &&
        !/booting|starting|loading|%/i.test(txt)) {
      return { ok: true, done: true, stage: "registered", url: location.href, text: "邮箱已注册过，直接进入主界面" };
    }

    // 到达真正主界面：不能仍在 signup/email-login/verify 流程里。
    if (!stillOnSignupFlow &&
        (/dashboard|welcome\s*back|explore|home/i.test(lower) ||
         (/zo space/i.test(txt) && /files/i.test(txt) && /chat/i.test(txt)) ||
         /your conversations|start a new conversation/i.test(txt)) &&
        !/booting|starting|loading|%/i.test(txt)) {
      return { ok: true, done: true, stage: "main", url: location.href };
    }

    // Go to your Zo / Get started
    if (/go to your zo|get started|get started with/i.test(txt)) {
      clickBtn(/go to your zo|get\s*started/i);
      await sleep(1000);
      return { ok: true, done: false, stage: "clicked_go_to_zo", url: location.href };
    }

    // 手机号验证 — 跳过
    if (/verify your phone|phone number|add your phone|enter your phone|mobile number/i.test(txt)) {
      clickBtn(/skip|not now|maybe later|skip for now/i) || clickBtn(/^Continue$/i);
      await sleep(1000);
      return { ok: true, done: false, stage: "skip_phone", url: location.href };
    }

    // Checkbox 页 (Terms of Use + 18 years)
    if (/terms of use|18.*years|agree/i.test(txt) ||
        (document.querySelectorAll('input[type=checkbox]:not(:checked)').length > 0 && /terms|agree|policy/i.test(txt))) {
      for (const cb of document.querySelectorAll('input[type=checkbox]')) {
        if (!cb.checked && cb.offsetParent !== null) {
          try { cb.click(); await sleep(500); } catch (e) {
            const label = cb.closest("label") || cb.parentElement;
            if (label) try { label.click(); } catch (e2) {}
          }
        }
      }
      await sleep(500);
      clickBtn(/skip\s*for\s*now|skip/i) || clickBtn(/^Continue$/i);
      await sleep(1000);
      return { ok: true, done: false, stage: "checkbox_skip", url: location.href };
    }

    // 问卷/偏好选择（常在加载过程中出现）
    if (isSurveyPage(lower)) {
      await handleSurvey();
      return { ok: true, done: false, stage: "survey", url: location.href };
    }

    // Profile 设置页兜底，不直接判成功
    if (/set up your profile|choose your handle|display name/i.test(txt)) {
      clickBtn(/^Continue$/i) || clickBtn(/skip\s*for\s*now|skip/i);
      await sleep(1000);
      return { ok: true, done: false, stage: "profile_fallback", url: location.href };
    }

    // 加载中，继续等待
    if (/booting|starting|loading|%|preparing|creating/i.test(txt)) {
      return { ok: true, done: false, stage: "loading", url: location.href };
    }

    // 出错
    if (/invalid|expired|something went wrong/i.test(txt)) {
      return { ok: false, done: false, error: "页面提示失败", stage: "error", url: location.href };
    }

    return { ok: true, done: false, stage: "unknown", url: location.href, text: txt.substring(0, 120).replace(/\n/g, " ") };
  }

  // 兼容旧消息名：不再长等待，只执行一次 tick
  async function stepWaitBoot() {
    return await stepOnboardingTick();
  }

  // 识别问卷/偏好页面
  function isSurveyPage(lower) {
    return /what.*(interest|prefer|looking|want|use)/i.test(lower) ||
           /select.*(interest|preference|topic|option)/i.test(lower) ||
           /choose.*(interest|preference|category)/i.test(lower) ||
           /how.*(use|plan|intend)/i.test(lower) ||
           /tell us/i.test(lower) ||
           /pick.*(up to|some|a few)/i.test(lower);
  }

  // 处理问卷页面 — 随机选一个然后继续/跳过
  async function handleSurvey() {
    // 随机点一个选项
    const options = document.querySelectorAll('button, div[role=button], label, .option, [class*=option], [class*=chip]');
    const visible = Array.from(options).filter(el => el.offsetParent !== null && el.textContent.trim().length > 0);
    if (visible.length > 0) {
      const idx = Math.floor(Math.random() * visible.length);
      visible[idx].click();
      await sleep(1500);
    }
    // 点击 Continue / Next / Skip / Done
    clickBtn(/continue|next|skip|done|submit/i);
    await sleep(2000);
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
            case "set_handle": result = await stepSetHandle(msg.email || "user"); break;
            case "wait_boot": result = await stepWaitBoot(); break;
            case "onboarding_tick": result = await stepOnboardingTick(); break;
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

