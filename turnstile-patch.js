/**
 * Cloudflare Turnstile 绕过补丁
 * ==============================
 * 核心原理：CDP/自动化工具模拟的点击事件中 MouseEvent.screenX === clientX,
 * 而 Turnstile 据此判断为自动化操作。此补丁劫持 MouseEvent/PointerEvent 的
 * screenX/screenY getter，返回 clientX + 随机偏移，模拟真实用户。
 *
 * 用法:
 *   Node.js (Puppeteer): await page.evaluateOnNewDocument(TURNSTILE_PATCH);
 *   Python (Playwright): page.add_init_script(open('turnstile-patch.js').read())
 */

// 适用于 evaluateOnNewDocument / addInitScript 的函数体
const TURNSTILE_PATCH = () => {
  if (window.__TURNSTILE_PATCHED__) return;
  window.__TURNSTILE_PATCHED__ = true;

  const rand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
  const offsetX = rand(80, 200);
  const offsetY = rand(60, 150);

  // 劫持 MouseEvent.prototype.screenX/screenY
  try {
    Object.defineProperty(MouseEvent.prototype, 'screenX', {
      get: function() { return (this.clientX || 0) + offsetX; },
      configurable: true
    });
    Object.defineProperty(MouseEvent.prototype, 'screenY', {
      get: function() { return (this.clientY || 0) + offsetY; },
      configurable: true
    });
  } catch (e) {}

  // 劫持 PointerEvent.prototype.screenX/screenY
  try {
    Object.defineProperty(PointerEvent.prototype, 'screenX', {
      get: function() { return (this.clientX || 0) + offsetX; },
      configurable: true
    });
    Object.defineProperty(PointerEvent.prototype, 'screenY', {
      get: function() { return (this.clientY || 0) + offsetY; },
      configurable: true
    });
  } catch (e) {}

  // 隐藏 navigator.webdriver
  try {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined, configurable: true });
  } catch (e) {}
};

// 适用于字符串注入的版本（Playwright add_init_script 接受字符串）
const TURNSTILE_PATCH_STRING = `
if (!window.__TURNSTILE_PATCHED__) {
  window.__TURNSTILE_PATCHED__ = true;
  var _offX = Math.floor(Math.random() * 121) + 80;
  var _offY = Math.floor(Math.random() * 91) + 60;
  try { Object.defineProperty(MouseEvent.prototype, 'screenX', { get: function() { return (this.clientX||0) + _offX; }, configurable: true }); } catch(e) {}
  try { Object.defineProperty(MouseEvent.prototype, 'screenY', { get: function() { return (this.clientY||0) + _offY; }, configurable: true }); } catch(e) {}
  try { Object.defineProperty(PointerEvent.prototype, 'screenX', { get: function() { return (this.clientX||0) + _offX; }, configurable: true }); } catch(e) {}
  try { Object.defineProperty(PointerEvent.prototype, 'screenY', { get: function() { return (this.clientY||0) + _offY; }, configurable: true }); } catch(e) {}
  try { Object.defineProperty(navigator, 'webdriver', { get: function() { return undefined; }, configurable: true }); } catch(e) {}
}
`;

// Turnstile 令牌获取函数（在页面上下文中执行）
const TURNSTILE_GET_TOKEN = () => {
  return new Promise((resolve) => {
    // 方法1: 直接通过 turnstile API 获取
    if (typeof turnstile !== 'undefined') {
      try { turnstile.reset(); } catch (e) {}
      let attempts = 0;
      const check = () => {
        attempts++;
        try {
          const res = turnstile.getResponse();
          if (res) { resolve(res); return; }
        } catch (e) {}
        if (attempts < 15) {
          setTimeout(check, 1000);
        } else {
          resolve(null);
        }
      };
      check();
      return;
    }

    // 方法2: 从隐藏字段读取
    try {
      const input = document.querySelector('input[name="cf-turnstile-response"]');
      if (input && input.value) { resolve(input.value); return; }
    } catch (e) {}

    resolve(null);
  });
};

// Turnstile 令牌填入函数
const TURNSTILE_FILL_TOKEN = (token) => {
  try {
    const input = document.querySelector('input[name="cf-turnstile-response"]');
    if (input) {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(input, token);
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }
  } catch (e) {}
  return false;
};

module.exports = {
  TURNSTILE_PATCH,
  TURNSTILE_PATCH_STRING,
  TURNSTILE_GET_TOKEN,
  TURNSTILE_FILL_TOKEN,
};
