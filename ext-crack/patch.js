/**
 * Turnstile Patcher — 注入 MAIN world + all_frames
 * 参考 grok-register-main 和 any-auto-register 的成熟方案
 */
(function(){
  'use strict';
  if (window.__CRACK_PATCHED__) return;
  window.__CRACK_PATCHED__ = true;

  // ===== 1. MouseEvent screenX/screenY (grok方案) =====
  var offX = Math.floor(Math.random() * 401) + 80;
  var offY = Math.floor(Math.random() * 201) + 60;

  try {
    Object.defineProperty(MouseEvent.prototype, 'screenX', {
      get: function(){ return (this.clientX || 0) + offX + Math.floor(Math.random()*5-2); },
      configurable: true
    });
    Object.defineProperty(MouseEvent.prototype, 'screenY', {
      get: function(){ return (this.clientY || 0) + offY + Math.floor(Math.random()*5-2); },
      configurable: true
    });
  } catch(e) {}

  if (typeof PointerEvent !== 'undefined') {
    try {
      Object.defineProperty(PointerEvent.prototype, 'screenX', {
        get: function(){ return (this.clientX || 0) + offX + Math.floor(Math.random()*5-2); },
        configurable: true
      });
      Object.defineProperty(PointerEvent.prototype, 'screenY', {
        get: function(){ return (this.clientY || 0) + offY + Math.floor(Math.random()*5-2); },
        configurable: true
      });
    } catch(e) {}
  }

  // ===== 2. navigator.webdriver =====
  try {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined, configurable: true });
    var d = Object.getOwnPropertyDescriptor(Navigator.prototype, 'webdriver');
    if (d) Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => false, configurable: true });
  } catch(e) {}

  // ===== 3. anti-Shadow DOM (any-auto-register方案) =====
  try {
    var origAttach = Element.prototype.attachShadow;
    Element.prototype.attachShadow = function(init) {
      var shadow = origAttach.call(this, init);
      if (init && init.mode === 'closed') {
        window.__lastClosedShadowRoot = shadow;
      }
      return shadow;
    };
  } catch(e) {}

  // ===== 4. outerWidth/Height =====
  try {
    if (window.top === window) {
      Object.defineProperty(window, 'outerWidth', {
        get: function(){ return window.innerWidth + 16 + Math.floor(Math.random()*2); },
        configurable: true
      });
      Object.defineProperty(window, 'outerHeight', {
        get: function(){ return window.innerHeight + 80 + Math.floor(Math.random()*5); },
        configurable: true
      });
    }
  } catch(e) {}

  // ===== 5. plugins =====
  try {
    Object.defineProperty(navigator, 'plugins', {
      get: function(){
        var arr = [
          { name:'Chrome PDF Plugin', filename:'internal-pdf-viewer', length:1 },
          { name:'Chrome PDF Viewer', filename:'mhjfbmdgcfjbbpaeojofohoefgiehjai', length:1 },
          { name:'Native Client', filename:'internal-nacl-plugin', length:1 }
        ];
        arr.item = function(i){ return this[i]; };
        arr.namedItem = function(n){ return this.find(function(p){ return p.name===n; }); };
        arr.refresh = function(){};
        Object.setPrototypeOf(arr, PluginArray.prototype);
        return arr;
      },
      configurable: true
    });
  } catch(e) {}

  // ===== 6. languages =====
  try {
    Object.defineProperty(navigator, 'languages', {
      get: function(){ return ['zh-CN','zh','en-US','en']; },
      configurable: true
    });
  } catch(e) {}

  // ===== 7. chrome.runtime (防止检测) =====
  try {
    if (!window.chrome) window.chrome = {};
    if (!window.chrome.runtime) {
      window.chrome.runtime = {
        connect: function(){ return { onMessage:{addListener:function(){}}, postMessage:function(){}, disconnect:function(){} }; },
        sendMessage: function(){},
        onMessage: { addListener: function(){} },
        onConnect: { addListener: function(){} }
      };
    }
  } catch(e) {}

  console.log('[ExtCrack] ✅ all patches active');

  // === 8. navigator.userAgentData (2026 Cloudflare头号检测向量) ===
  try {
    Object.defineProperty(navigator, 'userAgentData', {
      get: function(){
        var brands = [{brand:'Google Chrome',version:'131'},{brand:'Chromium',version:'131'},{brand:'Not_A Brand',version:'24'}];
        return {
          brands: brands, mobile: false, platform: 'Windows',
          getHighEntropyValues: async function(){ return { platform:'Windows', platformVersion:'10.0.0', architecture:'x86', uaFullVersion:'131.0.6778.265', bitness:'64' }; },
          toJSON: function(){ return {brands:brands,mobile:false,platform:'Windows'}; }
        };
      }, configurable: true
    });
  } catch(e) {}

  // === 9. hardwareConcurrency ===
  try {
    Object.defineProperty(navigator, 'hardwareConcurrency', {
      get: function(){ return 8; }, configurable: true
    });
  } catch(e) {}

  // === 10. Canvas noise ===
  try {
    var _td = HTMLCanvasElement.prototype.toDataURL;
    HTMLCanvasElement.prototype.toDataURL = function(){var c=this.getContext('2d');if(c){var d=c.getImageData(0,0,1,1);if(d&&d.data){d.data[0]=d.data[0]^(Math.random()>.5?1:0);}}return _td.apply(this,arguments);};
  } catch(e) {}
})();
