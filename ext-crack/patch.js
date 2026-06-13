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

  // ===== 8. navigator.userAgentData (Cloudflare强制检查!) =====
  try {
    if (navigator.userAgentData) {
      Object.defineProperty(navigator, 'userAgentData', {
        get: function(){
          return {
            brands: [{brand:'Google Chrome',version:'131'},{brand:'Chromium',version:'131'},{brand:'Not_A Brand',version:'24'}],
            mobile: false,
            platform: 'Windows',
            getHighEntropyValues: async function(hints) {
              var r = { platform:'Windows', platformVersion:'10.0.0', architecture:'x86', model:'', uaFullVersion:'131.0.6778.265', bitness:'64', fullVersionList:[{brand:'Google Chrome',version:'131.0.6778.265'},{brand:'Chromium',version:'131.0.6778.265'},{brand:'Not_A Brand',version:'24.0.0.0'}] };
              return r;
            },
            toJSON: function(){ return {brands:this.brands,mobile:this.mobile,platform:this.platform}; }
          };
        },
        configurable: true
      });
    }
  } catch(e) {}

  // ===== 9. hardwareConcurrency =====
  try {
    var cores = [8,12,16,10,6][Math.floor(Math.random()*5)];
    Object.defineProperty(navigator, 'hardwareConcurrency', { get: function(){ return cores; }, configurable: true });
  } catch(e) {}

  // ===== 10. deviceMemory =====
  try {
    var mems = [8,16,8,16,32,4,8][Math.floor(Math.random()*7)];
    Object.defineProperty(navigator, 'deviceMemory', { get: function(){ return mems; }, configurable: true });
  } catch(e) {}

  // ===== 11. screen properties =====
  try {
    Object.defineProperty(screen, 'colorDepth', { get: function(){ return 24; }, configurable: true });
    Object.defineProperty(screen, 'pixelDepth', { get: function(){ return 24; }, configurable: true });
  } catch(e) {}

  // ===== 12. Canvas fingerprint noise =====
  try {
    var origToDataURL = HTMLCanvasElement.prototype.toDataURL;
    HTMLCanvasElement.prototype.toDataURL = function() {
      var ctx = this.getContext('2d', {willReadFrequently:true});
      if (ctx) {
        var d = ctx.getImageData(0,0,1,1);
        if (d && d.data && d.data[3] !== undefined) {
          d.data[Math.floor(Math.random()*4)] = (d.data[Math.floor(Math.random()*4)] || 0) + (Math.random() > 0.5 ? 1 : -1);
        }
      }
      return origToDataURL.apply(this, arguments);
    };
  } catch(e) {}

  console.log('[ExtCrack] ✅ fingerprint patches active');
})();
