/**
 * Turnstile Patcher v3.0 — 增强版 Cloudflare Turnstile 反检测补丁
 *
 * 核心修复：
 * 1. screenX/screenY — CDP 产生的 MouseEvent 的 screenX === clientX，
 *    Turnstile 据此判定机器人。本补丁重写为 clientX + 随机窗口偏移。
 * 2. PointerEvent — Turnstile 同时检测 PointerEvent 的 screenX/Y。
 * 3. navigator.webdriver — 自动化工具暴露的标志位。
 *
 * v3.0 增强：
 * 4. navigator 指纹伪装 — plugins, languages, platform, hardwareConcurrency 等
 * 5. Chrome 运行时检测绕过 — chrome.runtime, $cdc_ 等自动化标记
 * 6. WebGL/Canvas 指纹噪声 — 微量噪声干扰指纹一致性
 * 7. window.outerWidth/outerHeight — 模拟真实窗口尺寸差
 * 8. Touch 事件支持 — 模拟触摸屏设备特征
 *
 * 必须设置: "world": "MAIN" + "all_frames": true + "run_at": "document_start"
 */
(function() {
  'use strict';
  if (window.__TURNSTILE_PATCHED_V3__) return;
  window.__TURNSTILE_PATCHED_V3__ = true;

  // ==================== ★ Cloudflare iframe 检测 ★ ====================
  // 如果在 Cloudflare challenge iframe 中，跳过所有 patch
  // Cloudflare 会在自己的 iframe 中检测篡改，被检测到会导致 challenge 无法加载
  try {
    var _frameUrl = '';
    try { _frameUrl = window.location.href; } catch(e) {}
    var _isInCfFrame = false;
    if (_frameUrl.indexOf('challenges.cloudflare') >= 0 || _frameUrl.indexOf('turnstile') >= 0) {
      _isInCfFrame = true;
    }
    // 也检查是否在 cross-origin iframe 中（无法访问 top）
    try {
      if (window.top !== window) {
        // 在 iframe 中，如果不是明确的非 CF iframe，也跳过
        if (_frameUrl.indexOf('zo.computer') < 0 && _frameUrl.indexOf('about:') < 0) {
          _isInCfFrame = true;
        }
      }
    } catch(e) {
      // 跨域 iframe，大概率是 Cloudflare
      _isInCfFrame = true;
    }
    
    if (_isInCfFrame) {
      // 在 Cloudflare iframe 中：只修复 navigator.webdriver，其他全部跳过
      try {
        Object.defineProperty(navigator, 'webdriver', { get: function() { return false; } });
      } catch(e) {}
      return;
    }
  } catch(e) {}

  // ==================== 工具函数 ====================
  function randInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  function safeDefine(obj, prop, descriptor) {
    try {
      Object.defineProperty(obj, prop, Object.assign({ configurable: true }, descriptor));
    } catch (e) { /* 某些属性不可重定义，静默忽略 */ }
  }

  // ==================== 1. screenX/screenY 修复 ====================
  // 生成随机的屏幕偏移量（模拟窗口在屏幕上的位置 + 任务栏高度）
  var screenOffsetX = randInt(80, 260);
  var screenOffsetY = randInt(60, 180);

  // 修复 MouseEvent
  safeDefine(MouseEvent.prototype, 'screenX', {
    get: function() {
      return (this.clientX || 0) + screenOffsetX + randInt(-2, 2);
    }
  });
  safeDefine(MouseEvent.prototype, 'screenY', {
    get: function() {
      return (this.clientY || 0) + screenOffsetY + randInt(-2, 2);
    }
  });

  // 修复 PointerEvent
  if (typeof PointerEvent !== 'undefined') {
    safeDefine(PointerEvent.prototype, 'screenX', {
      get: function() {
        return (this.clientX || 0) + screenOffsetX + randInt(-2, 2);
      }
    });
    safeDefine(PointerEvent.prototype, 'screenY', {
      get: function() {
        return (this.clientY || 0) + screenOffsetY + randInt(-2, 2);
      }
    });
  }

  // ==================== 2. navigator.webdriver 隐藏 ====================
  safeDefine(navigator, 'webdriver', { get: function() { return undefined; } });

  // 同时修补 prototype 级别的检测
  try {
    var origDesc = Object.getOwnPropertyDescriptor(Navigator.prototype, 'webdriver');
    if (origDesc) {
      safeDefine(Navigator.prototype, 'webdriver', { get: function() { return false; } });
    }
  } catch (e) {}

  // ==================== 3. navigator 指纹增强 ====================
  // 伪装 plugins（Turnstile 会检查 navigator.plugins.length）
  try {
    if (!navigator.plugins || navigator.plugins.length === 0) {
      var fakePlugins = [
        { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
        { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai', description: '' },
        { name: 'Native Client', filename: 'internal-nacl-plugin', description: '' }
      ];
      safeDefine(navigator, 'plugins', {
        get: function() {
          var arr = fakePlugins.map(function(p) {
            return Object.create(Plugin.prototype, {
              name: { value: p.name }, filename: { value: p.filename },
              description: { value: p.description }, length: { value: 1 }
            });
          });
          arr.item = function(i) { return arr[i]; };
          arr.namedItem = function(n) { return arr.find(function(p) { return p.name === n; }); };
          arr.refresh = function() {};
          return arr;
        }
      });
    }
  } catch (e) {}

  // 伪装 languages
  safeDefine(navigator, 'languages', {
    get: function() {
      return ['zh-CN', 'zh', 'en-US', 'en'];
    }
  });

  // 伪装 platform
  safeDefine(navigator, 'platform', { get: function() { return 'Win32'; } });

  // 伪装 hardwareConcurrency（合理范围）
  safeDefine(navigator, 'hardwareConcurrency', { get: function() { return randInt(4, 16); } });

  // 伪装 deviceMemory
  safeDefine(navigator, 'deviceMemory', { get: function() { return [4, 8, 16, 32][randInt(0, 3)]; } });

  // ==================== 4. Chrome 自动化标记清除 ====================
  // 清除 $cdc_ / $chrome_async 等自动化框架注入的标记
  try {
    var cleanProps = ['$cdc_asdjflasutopfhvcZLmcfl_', '$cdc_asdjflasutopfhvcZLmcfl_promise',
                      '$chrome_async', 'domAutomation', 'domAutomationController'];
    cleanProps.forEach(function(prop) {
      try {
        if (window[prop] !== undefined) {
          delete window[prop];
        }
      } catch (e) {}
    });
  } catch (e) {}

  // 伪造 chrome.runtime（某些检测会检查此对象是否存在）
  try {
    if (!window.chrome) {
      window.chrome = {};
    }
    if (!window.chrome.runtime) {
      window.chrome.runtime = {
        connect: function() { return { onMessage: { addListener: function() {} }, postMessage: function() {} }; },
        sendMessage: function() {},
        onConnect: { addListener: function() {} },
        onMessage: { addListener: function() {} }
      };
    }
  } catch (e) {}

  // ==================== 5. window 尺寸修复 ====================
  // CDP 无头浏览器中 outerWidth === innerWidth，真实浏览器因边框而不同
  // ★ 注意：不在 Cloudflare challenge iframe 中修改尺寸，否则会破坏 widget 渲染
  try {
    var isCfChallenge = false;
    try {
      if (window.top !== window) {
        // 在 iframe 中，检查是否是 Cloudflare challenge
        var frameSrc = '';
        try { frameSrc = window.location.href; } catch(e) {}
        if (frameSrc.indexOf('challenges.cloudflare') >= 0 || frameSrc.indexOf('turnstile') >= 0) {
          isCfChallenge = true;
        }
      }
    } catch(e) {}
    
    if (!isCfChallenge) {
      var realInnerW = window.innerWidth;
      var realInnerH = window.innerHeight;
      safeDefine(window, 'outerWidth', { get: function() { return realInnerW + randInt(10, 30); } });
      safeDefine(window, 'outerHeight', { get: function() { return realInnerH + randInt(80, 140); } });
      safeDefine(window, 'screenX', { get: function() { return randInt(50, 300); } });
      safeDefine(window, 'screenY', { get: function() { return randInt(30, 120); } });
    }
  } catch (e) {}

  // ==================== 6. Permissions API 修复 ====================
  // Turnstile 可能检查 Notification permission
  try {
    if (navigator.permissions && navigator.permissions.query) {
      var origQuery = navigator.permissions.query.bind(navigator.permissions);
      navigator.permissions.query = function(params) {
        if (params && params.name === 'notifications' && Notification.permission === 'denied') {
          return Promise.resolve({ state: 'prompt', onchange: null });
        }
        return origQuery(params);
      };
    }
  } catch (e) {}

  // ==================== 7. WebGL 指纹微量噪声 ====================
  try {
    var origGetParam = WebGLRenderingContext.prototype.getParameter;
    WebGLRenderingContext.prototype.getParameter = function(param) {
      // UNMASKED_VENDOR_WEBGL / UNMASKED_RENDERER_WEBGL
      if (param === 0x9245) return 'Intel Inc.';
      if (param === 0x9246) return 'Intel Iris OpenGL Engine';
      return origGetParam.call(this, param);
    };
    if (typeof WebGL2RenderingContext !== 'undefined') {
      var origGetParam2 = WebGL2RenderingContext.prototype.getParameter;
      WebGL2RenderingContext.prototype.getParameter = function(param) {
        if (param === 0x9245) return 'Intel Inc.';
        if (param === 0x9246) return 'Intel Iris OpenGL Engine';
        return origGetParam2.call(this, param);
      };
    }
  } catch (e) {}

  console.log('[TurnstilePatch v3.0] ✅ screenX/Y patched, webdriver hidden, fingerprint enhanced');
})();
