/**
 * Cloudflare Turnstile 绕过 - Chrome 扩展版
 * 
 * 关键：document_start + MAIN world + all_frames
 * 在任何页面脚本运行前注入，包括 Turnstile iframe Shadow DOM
 * 
 * 核心原理：Turnstile 检测 MouseEvent.screenX === clientX → 机器人
 * 真实用户 screenX = clientX + 窗口左边距（通常 80~200px）
 */

(function() {
  if (window.__CF_BYPASS__) return;
  window.__CF_BYPASS__ = true;

  // 每个 frame 独立随机偏移，避免模式检测
  var _wOffX = 100 + Math.floor(Math.random() * 100); // 100~199
  var _wOffY = 60 + Math.floor(Math.random() * 80);   // 60~139

  var _dp = function(obj, prop, getter) {
    try {
      Object.defineProperty(obj, prop, {
        get: getter,
        configurable: true,
        enumerable: true
      });
    } catch(e) {}
  };

  // ====== L1: MouseEvent/PointerEvent screen 坐标伪装 ======
  _dp(MouseEvent.prototype, 'screenX', function() {
    return (this.clientX || 0) + _wOffX;
  });
  _dp(MouseEvent.prototype, 'screenY', function() {
    return (this.clientY || 0) + _wOffY;
  });
  _dp(MouseEvent.prototype, 'x', function() {
    return this.clientX || 0;
  });
  _dp(MouseEvent.prototype, 'y', function() {
    return this.clientY || 0;
  });
  _dp(PointerEvent.prototype, 'screenX', function() {
    return (this.clientX || 0) + _wOffX;
  });
  _dp(PointerEvent.prototype, 'screenY', function() {
    return (this.clientY || 0) + _wOffY;
  });

  // ====== L2: navigator 属性伪装 ======
  _dp(navigator, 'webdriver', function() { return undefined; });
  _dp(navigator, 'languages', function() { return ['zh-CN', 'zh', 'en-US', 'en']; });
  _dp(navigator, 'language', function() { return 'zh-CN'; });
  _dp(navigator, 'platform', function() { return 'Win32'; });
  _dp(navigator, 'hardwareConcurrency', function() { return 8; });
  _dp(navigator, 'deviceMemory', function() { return 8; });

  // plugins 补全（无头浏览器通常 plugins.length === 0）
  if (navigator.plugins.length === 0) {
    var fakePlugins = {
      0: { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
      1: { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai', description: '' },
      2: { name: 'Native Client', filename: 'internal-nacl-plugin', description: '' },
      length: 3,
      item: function(i) { return this[i] || null; },
      namedItem: function(name) {
        for (var i = 0; i < this.length; i++) {
          if (this[i].name === name) return this[i];
        }
        return null;
      },
      refresh: function() {},
      [Symbol.iterator]: function*() {
        for (var i = 0; i < this.length; i++) yield this[i];
      }
    };
    _dp(navigator, 'plugins', function() { return fakePlugins; });
  }

  // ====== L3: chrome.runtime 补全 ======
  if (!window.chrome) window.chrome = {};
  if (!window.chrome.runtime) {
    window.chrome.runtime = {
      connect: function() {
        return {
          onMessage: { addListener: function(){}, removeListener: function(){} },
          postMessage: function(){},
          disconnect: function(){}
        };
      },
      sendMessage: function() {},
      onMessage: { addListener: function(){}, removeListener: function(){} },
      PlatformOs: { MAC: 'mac', WIN: 'win', ANDROID: 'android', CROS: 'cros', LINUX: 'linux', OPENBSD: 'openbsd' },
      PlatformArch: { ARM: 'arm', X86_32: 'x86-32', X86_64: 'x86-64' },
      PlatformNaclArch: { ARM: 'arm', X86_32: 'x86-32', X86_64: 'x86-64' },
      RequestUpdateCheckStatus: { THROTTLED: 'throttled', NO_UPDATE: 'no_update', UPDATE_AVAILABLE: 'update_available' },
      OnInstalledReason: { INSTALL: 'install', UPDATE: 'update', CHROME_UPDATE: 'chrome_update', SHARED_MODULE_UPDATE: 'shared_module_update' },
      OnRestartRequiredReason: { APP_UPDATE: 'app_update', OS_UPDATE: 'os_update', PERIODIC: 'periodic' },
    };
  }

  // ====== L4: 隐藏自动化痕迹 ======
  // 删除 window.cdc_ 属性（ChromeDriver 痕迹）
  for (var key in window) {
    if (/^cdc_/.test(key)) {
      try { delete window[key]; } catch(e) {}
    }
  }

  // 隐藏 Selenium/Playwright 痕迹
  try {
    Object.defineProperty(document, 'webdriver', { get: function() { return undefined; } });
  } catch(e) {}

  // ====== L5: MutationObserver 监听 Turnstile iframe ======
  if (typeof MutationObserver !== 'undefined') {
    var observer = new MutationObserver(function(mutations) {
      for (var m = 0; m < mutations.length; m++) {
        var nodes = mutations[m].addedNodes;
        for (var n = 0; n < nodes.length; n++) {
          var node = nodes[n];
          if (node.tagName === 'IFRAME' && node.src && /turnstile|cloudflare|challenges/i.test(node.src)) {
            // Turnstile iframe 被添加，由于 all_frames: true 扩展会自动注入
            // 但我们也可以在此做额外处理
          }
        }
      }
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }
})();
