/**
 * ZO Computer 注册脚本 - 优化版 v3
 * ==============================
 * 核心改进：
 *   1. evaluateOnNewDocument + MAIN world 注入 Turnstile 绕过
 *   2. 自动启动 Chrome（CDP 可视模式）
 *   3. CDP 原生鼠标模拟（贝塞尔曲线人类轨迹）
 *   4. 每个邮箱独立 browser context
 *
 * 用法: node zo_register_optimized.cjs [--count N]
 */

const puppeteer = require("E:\\API获取工具\\ZO注册\\node_modules\\puppeteer-core");
const { readFileSync, writeFileSync, appendFileSync, readdirSync, renameSync, mkdirSync, existsSync } = require("fs");
const { join } = require("path");
const { spawn } = require("child_process");

// ======================== 配置 ========================
const CONFIG = {
  CHROME_PATH: "C:\\Users\\XZXyuan\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe",
  CDP_PORT: 9222,
  USER_DATA_DIR: "C:\\Users\\XZXyuan\\AppData\\Local\\Google\\Chrome\\User Data - ZO",
  EMAIL_DIR: "C:\\Users\\XZXyuan\\Downloads\\批量注册邮箱\\已经使用",
  REGISTERED_DIR: "E:\\API获取工具\\ZO注册\\registered",
  RESULTS_FILE: "E:\\API获取工具\\ZO注册\\registered\\results.jsonl",
  SIGNUP_URL: "https://www.zo.computer/signup",
  GRAPH_TOKEN_URL: "https://login.microsoftonline.com/consumers/oauth2/v2.0/token",
  GRAPH_MAIL_URL: "https://graph.microsoft.com/v1.0/me/messages",
  VIEWPORT: { width: 1440, height: 900 },
};

if (!existsSync(CONFIG.REGISTERED_DIR)) mkdirSync(CONFIG.REGISTERED_DIR, { recursive: true });

// ======================== Turnstile 绕过补丁 ========================
// 核心原理：Turnstile 检测 MouseEvent.screenX === clientX → 机器人
// 真实用户 screenX = clientX + 窗口左边距（通常 100~200px）
// 五层绕过：L1 screen坐标 | L2 navigator | L3 chrome.runtime | L4 plugins | L5 webdriver隐藏

const TURNSTILE_PATCH = `(function(){
  if(window.__CF_BYPASS__)return;window.__CF_BYPASS__=true;
  var X=100+Math.floor(Math.random()*100),Y=60+Math.floor(Math.random()*80);
  var D=function(o,p,g){try{Object.defineProperty(o,p,{get:g,configurable:true,enumerable:true})}catch(e){}};
  D(MouseEvent.prototype,'screenX',function(){return(this.clientX||0)+X});
  D(MouseEvent.prototype,'screenY',function(){return(this.clientY||0)+Y});
  D(PointerEvent.prototype,'screenX',function(){return(this.clientX||0)+X});
  D(PointerEvent.prototype,'screenY',function(){return(this.clientY||0)+Y});
  D(MouseEvent.prototype,'x',function(){return this.clientX||0});
  D(MouseEvent.prototype,'y',function(){return this.clientY||0});
  D(navigator,'webdriver',function(){return undefined});
  D(navigator,'languages',function(){return['zh-CN','zh','en-US','en']});
  D(navigator,'language',function(){return'zh-CN'});
  D(navigator,'platform',function(){return'Win32'});
  D(navigator,'hardwareConcurrency',function(){return 8});
  D(navigator,'deviceMemory',function(){return 8});
  if(navigator.plugins.length===0){var fp={0:{name:'Chrome PDF Plugin',filename:'internal-pdf-viewer',description:'Portable Document Format'},1:{name:'Chrome PDF Viewer',filename:'mhjfbmdgcfjbbpaeojofohoefgiehjai',description:''},2:{name:'Native Client',filename:'internal-nacl-plugin',description:''},length:3,item:function(i){return this[i]||null},namedItem:function(n){for(var i=0;i<this.length;i++)if(this[i].name===n)return this[i];return null},refresh:function(){},[Symbol.iterator]:function*(){for(var i=0;i<this.length;i++)yield this[i]}};D(navigator,'plugins',function(){return fp})}
  if(!window.chrome)window.chrome={};
  if(!window.chrome.runtime){window.chrome.runtime={connect:function(){return{onMessage:{addListener:function(){},removeListener:function(){}},postMessage:function(){},disconnect:function(){}}},sendMessage:function(){},onMessage:{addListener:function(){},removeListener:function(){}}}}
  for(var k in window){if(/^cdc_/.test(k))try{delete window[k]}catch(e){}}
})();`;

// ======================== 工具函数 ========================
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function log(msg) {
  const time = new Date().toISOString().substring(11, 19);
  console.log("[" + time + "] " + msg);
}

// ======================== Chrome 启动 ========================
function isPortOpen(port) {
  return new Promise((resolve) => {
    const net = require("net");
    const socket = new net.Socket();
    socket.setTimeout(1500);
    socket.on("connect", () => { socket.destroy(); resolve(true); });
    socket.on("timeout", () => { socket.destroy(); resolve(false); });
    socket.on("error", () => { socket.destroy(); resolve(false); });
    socket.connect(port, "127.0.0.1");
  });
}

async function ensureChromeRunning() {
  if (await isPortOpen(CONFIG.CDP_PORT)) {
    log("Chrome CDP already running on port " + CONFIG.CDP_PORT);
    return;
  }

  log("Launching Chrome (CDP port " + CONFIG.CDP_PORT + ", visible mode)...");
  const chromeProc = spawn(CONFIG.CHROME_PATH, [
    "--remote-debugging-port=" + CONFIG.CDP_PORT,
    "--remote-allow-origins=*",
    "--user-data-dir=" + CONFIG.USER_DATA_DIR,
    "--no-first-run",
    "--disable-default-apps",
    "--disable-popup-blocking",
    "--disable-translate",
    "--disable-background-timer-throttling",
    "--disable-backgrounding-occluded-windows",
    "--disable-renderer-backgrounding",
  ], { detached: true, stdio: "ignore" });
  chromeProc.unref();

  for (let i = 0; i < 20; i++) {
    await sleep(500);
    if (await isPortOpen(CONFIG.CDP_PORT)) {
      log("Chrome started, CDP ready");
      await sleep(2000);
      return;
    }
  }
  throw new Error("Chrome launch timeout");
}

// ======================== Graph API ========================
async function getMailToken(clientId, refreshToken) {
  const body = new URLSearchParams({
    client_id: clientId, grant_type: "refresh_token", refresh_token: refreshToken,
    scope: "https://graph.microsoft.com/.default offline_access",
  });
  const resp = await fetch(CONFIG.GRAPH_TOKEN_URL, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: body.toString(),
  });
  const data = await resp.json();
  if (data.error) throw new Error("Token error: " + data.error_description);
  return { accessToken: data.access_token, newRefreshToken: data.refresh_token || refreshToken };
}

async function findMagicLink(accessToken, afterTime) {
  const url = CONFIG.GRAPH_MAIL_URL + "?$top=8&$select=subject,body,receivedDateTime&$orderby=receivedDateTime%20desc";
  const resp = await fetch(url, { headers: { Authorization: "Bearer " + accessToken } });
  const mail = await resp.json();
  for (const msg of (mail.value || [])) {
    if (new Date(msg.receivedDateTime) < afterTime) continue;
    const combined = (msg.subject || "") + " " + ((msg.body && msg.body.content) || "");
    if (!/zo\s*computer/i.test(combined)) continue;
    const links = combined.match(/https:\/\/www\.zo\.computer\/api\/email-login\/verify[^\s"'<>]*/gi) || [];
    for (let link of links) {
      link = link.replace(/[)\]>,;!?\s]+$/, "").replace(/&amp;/g, "&");
      if (link.includes("token=")) return link;
    }
    const fallbackLinks = combined.match(/https?:\/\/[^\s"'<>]*zo\.computer[^\s"'<>]*/gi) || [];
    for (let link of fallbackLinks) {
      link = link.replace(/[)\]>,;!?\s]+$/, "").replace(/&amp;/g, "&");
      if (/login|verify|auth|magic|token|callback/i.test(link) && !/\.(png|jpg|css|js|svg|ico)/i.test(link)) {
        return link;
      }
    }
  }
  return null;
}

async function pollMagicLink(clientId, refreshToken, afterTime, maxWaitMs) {
  maxWaitMs = maxWaitMs || 180000;
  let rt = refreshToken;
  const deadline = Date.now() + maxWaitMs;
  let pollCount = 0;
  while (Date.now() < deadline) {
    pollCount++;
    try {
      const { accessToken, newRefreshToken } = await getMailToken(clientId, rt);
      rt = newRefreshToken;
      const link = await findMagicLink(accessToken, afterTime);
      if (link) return { link: link, newRefreshToken: rt };
      // 每隔 3 次轮询详细打印收件箱情况，方便排查
      if (pollCount % 3 === 0) {
        try {
          const debugUrl = CONFIG.GRAPH_MAIL_URL + "?$top=5&$select=subject,receivedDateTime&$orderby=receivedDateTime%20desc";
          const resp = await fetch(debugUrl, { headers: { Authorization: "Bearer " + accessToken } });
          const mail = await resp.json();
          if (mail.value && mail.value.length > 0) {
            log("\n  [DEBUG] Inbox recent " + mail.value.length + " mails (after " + afterTime.toISOString() + "):");
            for (const msg of mail.value) {
              log("    " + msg.receivedDateTime + " | " + (msg.subject || "(no subject)").substring(0, 80));
            }
          } else {
            log("\n  [DEBUG] Inbox: no recent mails or access issue");
            if (mail.error) log("  [DEBUG] Graph error: " + JSON.stringify(mail.error));
          }
        } catch (de) {
          log("\n  [DEBUG] inbox check failed: " + de.message);
        }
      }
    } catch (e) {
      log("\n  [WARN] poll: " + e.message);
    }
    process.stdout.write(".");
    await sleep(5000);
  }
  return null;
}

// ======================== 人类鼠标模拟 ========================
function generateHumanPath(sx, sy, ex, ey, steps) {
  steps = steps || 20 + Math.floor(Math.random() * 15);
  const pts = [];
  const c1x = sx + (ex-sx)*0.3 + (Math.random()-0.5)*60;
  const c1y = sy + (ey-sy)*0.1 + (Math.random()-0.5)*60;
  const c2x = sx + (ex-sx)*0.7 + (Math.random()-0.5)*60;
  const c2y = sy + (ey-sy)*0.9 + (Math.random()-0.5)*60;
  for (let i = 0; i <= steps; i++) {
    const t = i/steps, u = 1-t;
    let x = u*u*u*sx + 3*u*u*t*c1x + 3*u*t*t*c2x + t*t*t*ex + (Math.random()-0.5)*2;
    let y = u*u*u*sy + 3*u*u*t*c1y + 3*u*t*t*c2y + t*t*t*ey + (Math.random()-0.5)*2;
    pts.push({x: Math.round(x), y: Math.round(y)});
  }
  return pts;
}

async function humanClick(page, x, y) {
  const path = generateHumanPath(x-100+Math.floor(Math.random()*200), y-50+Math.floor(Math.random()*100), x, y);
  for (const pt of path) { await page.mouse.move(pt.x, pt.y); await sleep(5+Math.floor(Math.random()*10)); }
  await page.mouse.down();
  await sleep(50+Math.floor(Math.random()*80));
  await page.mouse.up();
  await sleep(100+Math.floor(Math.random()*150));
}

// ======================== Turnstile 令牌操作 ========================
async function tryGetTurnstileToken(page) {
  return page.evaluate(() => {
    try {
      if (typeof turnstile !== 'undefined') {
        const res = turnstile.getResponse();
        if (res) {
          const input = document.querySelector('input[name="cf-turnstile-response"]');
          if (input && !input.value) {
            const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
            setter.call(input, res);
            input.dispatchEvent(new Event('change', { bubbles: true }));
          }
          return { ok: true, method: 'getResponse', len: res.length };
        }
      }
    } catch (e) {}
    try {
      const input = document.querySelector('input[name="cf-turnstile-response"]');
      if (input && input.value) return { ok: true, method: 'hiddenField', len: input.value.length };
    } catch (e) {}
    return { ok: false };
  }).catch(() => ({ ok: false }));
}

async function tryResetTurnstile(page) {
  return page.evaluate(() => {
    try { if (typeof turnstile !== 'undefined') { turnstile.reset(); return true; } } catch (e) {}
    return false;
  }).catch(() => false);
}

// ======================== 页面操作 ========================
async function getBodyText(page, len) {
  return page.evaluate((l) => document.body ? document.body.innerText.substring(0, l) : "", len || 500).catch(() => "");
}

async function clickButtonByText(page, pattern) {
  return page.evaluate((p) => {
    for (const el of document.querySelectorAll("button, a, div[role=button], span[role=button]")) {
      if (new RegExp(p, "i").test(el.textContent.trim()) && el.offsetParent !== null) {
        el.click(); return el.textContent.trim();
      }
    }
    return false;
  }, pattern);
}

async function fillInputValue(page, selector, value) {
  return page.evaluate((sel, val) => {
    const inp = document.querySelector(sel) || document.getElementById(sel);
    if (!inp) return false;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    setter.call(inp, val);
    inp.dispatchEvent(new Event("input", { bubbles: true }));
    inp.dispatchEvent(new Event("change", { bubbles: true }));
    inp.dispatchEvent(new Event("blur", { bubbles: true }));
    return true;
  }, selector, value);
}

// ======================== 注入补丁 ========================
async function injectPatch(page) {
  try {
    await page.evaluateOnNewDocument(TURNSTILE_PATCH, { world: 'MAIN' });
  } catch (e) {
    // Fallback: try without world option (older puppeteer)
    try { await page.evaluateOnNewDocument(TURNSTILE_PATCH); } catch (e2) {}
  }
  await page.evaluate(TURNSTILE_PATCH).catch(() => {});
}

// ======================== 获取 ZO Access Token ========================
async function getZoAccessToken(page, email, handle) {
  log("[8/8] Obtaining ZO Access Token...");

  // 8.1 导航到 Settings 页面
  const currentUrl = page.url();
  let settingsUrl = "https://www.zo.computer/settings";

  // 从当前 URL 推断 base URL
  const urlMatch = currentUrl.match(/^(https?:\/\/[^/]+\.zo\.computer)/);
  if (urlMatch) {
    settingsUrl = urlMatch[1] + "/settings";
  } else {
    const baseMatch = currentUrl.match(/^(https?:\/\/[^/]+)/);
    if (baseMatch) settingsUrl = baseMatch[1] + "/settings";
  }

  log("  Navigating to settings: " + settingsUrl);
  try {
    await page.goto(settingsUrl, { waitUntil: "networkidle2", timeout: 30000 });
  } catch (e) {
    try { await page.goto(settingsUrl, { waitUntil: "domcontentloaded", timeout: 30000 }); } catch (e2) {}
  }
  await sleep(3000);

  let bodyText = await getBodyText(page, 500);

  // 如果无法到达 settings，尝试通过 UI 点击进入
  if (!/setting|advanced|billing|my zo/i.test(bodyText)) {
    log("  Direct URL failed, trying UI navigation...");

    // 尝试点击设置齿轮图标或设置链接
    const settingsClicked = await page.evaluate(() => {
      // 尝试各种设置入口：齿轮图标、设置链接、用户菜单等
      const selectors = [
        'a[href*="settings"]', 'a[href*="setting"]',
        'button[aria-label*="settings" i]', 'button[aria-label*="Settings" i]',
        'a[aria-label*="settings" i]',
        '[data-testid*="settings" i]', '[data-testid*="setting" i]',
      ];
      for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (el && el.offsetParent !== null) { el.click(); return "selector:" + sel; }
      }
      // 尝试文本匹配
      for (const el of document.querySelectorAll("a, button, [role=button]")) {
        if (/settings|设置|gear|⚙/i.test(el.textContent.trim()) && el.offsetParent !== null) {
          el.click(); return "text:" + el.textContent.trim();
        }
      }
      return false;
    });

    if (settingsClicked) {
      log("  Clicked settings entry: " + settingsClicked);
      await sleep(3000);
    } else {
      log("  [WARN] Cannot find settings entry");
      return null;
    }
  }

  // 8.2 点击 "Advanced" 标签
  log("  Clicking 'Advanced' tab...");
  let advancedClicked = false;

  for (let attempt = 0; attempt < 3; attempt++) {
    advancedClicked = await page.evaluate(() => {
      // 策略1: 直接文本匹配 tab/按钮
      for (const el of document.querySelectorAll("button, a, [role=tab], [role=menuitem], div[role=button], span")) {
        const text = el.textContent.trim();
        if (/^Advanced$/i.test(text) && el.offsetParent !== null) {
          el.click(); return "text:" + text;
        }
      }
      // 策略2: href 匹配
      for (const el of document.querySelectorAll('a[href*="advanced"], a[href*="Advanced"]')) {
        if (el.offsetParent !== null) { el.click(); return "href"; }
      }
      // 策略3: data 属性
      for (const el of document.querySelectorAll('[data-tab="advanced"], [data-value="advanced"], [data-tab-id="advanced"]')) {
        el.click(); return "data-attr";
      }
      return false;
    });

    if (advancedClicked) break;
    await sleep(2000);
  }

  if (!advancedClicked) {
    // 最后尝试直接导航到 advanced 页面
    const advUrl = settingsUrl + "/advanced";
    log("  Advanced tab not found, trying direct URL: " + advUrl);
    try {
      await page.goto(advUrl, { waitUntil: "networkidle2", timeout: 20000 });
      await sleep(2000);
    } catch (e) {}
  } else {
    log("  Advanced tab clicked: " + advancedClicked);
  }

  await sleep(3000);

  // 8.3 确认到达 Advanced 页面，寻找 Access Tokens 区域
  bodyText = await getBodyText(page, 1500);
  log("  Page content preview: " + bodyText.substring(0, 200));

  if (!/access\s*tokens?|api\s*key|authenticate/i.test(bodyText)) {
    log("  [WARN] Access Tokens section not found on page");
    await page.screenshot({ path: join(CONFIG.REGISTERED_DIR, "debug_no_advanced_" + Date.now() + ".png") }).catch(() => {});
    return null;
  }
  log("  Access Tokens section found!");

  // 8.4 输入密钥名称
  const keyName = "MCP-" + handle;
  log("  Filling key name: " + keyName);

  const inputFilled = await page.evaluate((name) => {
    // 策略1: Access Tokens 区域内的输入框
    const tokenSection = document.querySelector('[class*="token"], [class*="Token"], [id*="token"]');
    if (tokenSection) {
      const inp = tokenSection.querySelector("input[type=text], input:not([type])");
      if (inp) {
        inp.focus(); inp.click();
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
        setter.call(inp, name);
        inp.dispatchEvent(new Event("input", { bubbles: true }));
        inp.dispatchEvent(new Event("change", { bubbles: true }));
        return "section-input";
      }
    }
    // 策略2: placeholder 匹配
    for (const inp of document.querySelectorAll("input")) {
      const ph = (inp.placeholder || "").toLowerCase();
      const label = (inp.getAttribute("aria-label") || "").toLowerCase();
      if (/key\s*name|name|token|label|e\.g/i.test(ph) || /key\s*name/i.test(label)) {
        inp.focus(); inp.click();
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
        setter.call(inp, name);
        inp.dispatchEvent(new Event("input", { bubbles: true }));
        inp.dispatchEvent(new Event("change", { bubbles: true }));
        return "placeholder:" + inp.placeholder;
      }
    }
    // 策略3: Access Tokens 文本附近的输入框
    for (const el of document.querySelectorAll("h1, h2, h3, h4, h5, h6, p, label, span, div")) {
      if (/access\s*tokens?/i.test(el.textContent) && el.textContent.length < 100) {
        const parent = el.closest("section, [class*=card], [class*=panel], [class*=container], form, div");
        if (parent) {
          const inp = parent.querySelector("input[type=text], input:not([type]), input[type=search]");
          if (inp && inp.offsetParent !== null) {
            inp.focus(); inp.click();
            const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
            setter.call(inp, name);
            inp.dispatchEvent(new Event("input", { bubbles: true }));
            inp.dispatchEvent(new Event("change", { bubbles: true }));
            return "nearby-input";
          }
        }
      }
    }
    // 策略4: 页面上唯一的文本输入框
    const allInputs = [...document.querySelectorAll("input[type=text], input:not([type])")].filter(i => i.offsetParent !== null);
    if (allInputs.length === 1) {
      const inp = allInputs[0];
      inp.focus(); inp.click();
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
      setter.call(inp, name);
      inp.dispatchEvent(new Event("input", { bubbles: true }));
      inp.dispatchEvent(new Event("change", { bubbles: true }));
      return "only-input";
    }
    return false;
  }, keyName);

  if (!inputFilled) {
    log("  [WARN] Key name input not found");
    await page.screenshot({ path: join(CONFIG.REGISTERED_DIR, "debug_no_input_" + Date.now() + ".png") }).catch(() => {});
    return null;
  }
  log("  Input filled via: " + inputFilled);
  await sleep(1000);

  // 8.5 点击 "Add" 按钮
  log("  Clicking 'Add' button...");
  let addClicked = false;

  for (let attempt = 0; attempt < 3; attempt++) {
    addClicked = await page.evaluate(() => {
      // 策略1: 文本匹配 Add 按钮
      for (const el of document.querySelectorAll("button, [role=button], input[type=submit]")) {
        const text = el.textContent.trim();
        if (/^Add$/i.test(text) && el.offsetParent !== null) { el.click(); return "text:" + text; }
      }
      // 策略2: 按钮值
      for (const el of document.querySelectorAll('input[type=submit][value*="add" i], button[value*="add" i]')) {
        el.click(); return "value:" + el.value;
      }
      // 策略3: Access Tokens 区域内的按钮
      for (const el of document.querySelectorAll("h1, h2, h3, h4, h5, h6, p, label, span")) {
        if (/access\s*tokens?/i.test(el.textContent) && el.textContent.length < 100) {
          const parent = el.closest("section, [class*=card], [class*=panel], [class*=container], form, div");
          if (parent) {
            const btn = parent.querySelector('button, [role=button], input[type=submit]');
            if (btn && btn.offsetParent !== null && /add|create|generate|添加|创建/i.test(btn.textContent || btn.value || "")) {
              btn.click(); return "section-btn:" + (btn.textContent || btn.value).trim();
            }
          }
        }
      }
      return false;
    });

    if (addClicked) break;
    await sleep(1500);
  }

  if (!addClicked) {
    // 尝试按 Enter 键提交
    log("  Add button not found, trying Enter key...");
    await page.keyboard.press("Enter");
    addClicked = "enter-key";
  }
  log("  Add clicked via: " + addClicked);

  // 8.6 等待 Token 生成
  await sleep(5000);

  // 8.7 获取生成的 Token
  log("  Retrieving generated token...");
  let token = null;

  for (let attempt = 0; attempt < 8; attempt++) {
    // 策略1: 查找 code / pre / 等宽元素中的 token
    token = await page.evaluate(() => {
      const codeEls = document.querySelectorAll("code, pre, .token, [class*=token-value], [class*=api-key], [class*=secret], [class*=mono], kbd, samp, [style*='monospace'], [style*='Courier']");
      for (const el of codeEls) {
        const text = el.textContent.trim();
        // 匹配各种 token 格式
        if (text.length >= 20 && /^[a-zA-Z0-9+/=_\-:.]+$/.test(text)) {
          return { token: text, method: "code-element:" + el.tagName };
        }
      }
      return null;
    });

    if (token) break;

    // 策略2: 查找只读 input / textarea（通常用于显示生成的密钥）
    token = await page.evaluate(() => {
      const inputs = document.querySelectorAll("input[readonly], textarea[readonly], input[disabled], input[type=text]");
      for (const inp of inputs) {
        const val = inp.value.trim();
        if (val.length >= 20 && /^[a-zA-Z0-9+/=_\-:.]+$/.test(val) && !/http|www/i.test(val)) {
          return { token: val, method: "input-value" };
        }
      }
      return null;
    });

    if (token) break;

    // 策略3: 查找 clipboard / copy 相关按钮旁边的文本
    token = await page.evaluate(() => {
      // 找到复制按钮，获取其关联的文本
      for (const btn of document.querySelectorAll("button, [role=button], a")) {
        const btnText = btn.textContent.trim();
        if (/copy|复制|clipboard/i.test(btnText)) {
          const parent = btn.closest("div, section, li, tr, [class*=row], [class*=item]");
          if (parent) {
            // 查找父元素中最长的疑似 token 文本
            const allText = parent.innerText.split("\n");
            for (const t of allText) {
              const trimmed = t.trim();
              if (trimmed.length >= 20 && /^[a-zA-Z0-9+/=_\-:.]+$/.test(trimmed) && !/copy|复制|key\s*name|date/i.test(trimmed)) {
                return { token: trimmed, method: "copy-btn-parent" };
              }
            }
          }
        }
      }
      return null;
    });

    if (token) break;

    // 策略4: 从页面全文提取
    const fullText = await page.evaluate(() => document.body ? document.body.innerText : "").catch(() => "");
    // 匹配常见的 API key 格式：
    // - sk_xxx, pk_xxx, key_xxx, token_xxx
    // - 长 base64/hex 字符串
    // - JWT (eyJ...)
    const patterns = [
      /(?:sk|pk|key|token|ak|zk|at)[_-][a-zA-Z0-9]{16,}/gi,
      /\beyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\b/g,
      /(?:^|\n)\s*([a-f0-9]{40,})\s*(?:\n|$)/gim,
      /(?:^|\n)\s*([a-zA-Z0-9+/]{32,}={0,2})\s*(?:\n|$)/gm,
    ];
    for (const pattern of patterns) {
      const match = pattern.exec(fullText);
      if (match) {
        token = { token: match[0].trim(), method: "fulltext-regex" };
        break;
      }
    }

    if (token) break;

    // 策略5: 尝试点击 "Copy" 按钮，从剪贴板获取
    const copyClicked = await page.evaluate(() => {
      for (const btn of document.querySelectorAll("button, [role=button], a")) {
        const text = btn.textContent.trim();
        if (/^Copy$|^复制$|copy.*token|copy.*key/i.test(text) && btn.offsetParent !== null) {
          btn.click(); return text;
        }
      }
      // 尝试找 SVG 图标按钮（常见的复制图标）
      for (const btn of document.querySelectorAll("button svg, [role=button] svg")) {
        const parent = btn.closest("button, [role=button]");
        if (parent && parent.offsetParent !== null) {
          parent.click(); return "svg-icon-btn";
        }
      }
      return false;
    });

    if (copyClicked) {
      log("  Clicked copy button: " + copyClicked + ", trying clipboard...");
      await sleep(1000);
      // 尝试通过 CDP 获取剪贴板
      try {
        const clipText = await page.evaluate(async () => {
          try { return await navigator.clipboard.readText(); } catch (e) { return null; }
        });
        if (clipText && clipText.length >= 20 && /^[a-zA-Z0-9+/=_\-:.]+$/.test(clipText.trim())) {
          token = { token: clipText.trim(), method: "clipboard" };
          break;
        }
      } catch (e) {}
    }

    if (attempt < 7) {
      log("  Waiting for token to appear... [" + ((attempt + 1) * 3) + "s]");
      await sleep(3000);
    }
  }

  if (!token) {
    log("  [WARN] Could not retrieve token automatically");
    await page.screenshot({ path: join(CONFIG.REGISTERED_DIR, "debug_token_fail_" + Date.now() + ".png") }).catch(() => {});
    return null;
  }

  log("  [OK] Token retrieved via " + token.method + " (length: " + token.token.length + ")");
  log("  Token preview: " + token.token.substring(0, 40) + "...");

  // 尝试点击复制按钮（方便用户手动粘贴）
  await page.evaluate(() => {
    for (const btn of document.querySelectorAll("button, [role=button], a")) {
      if (/copy|复制/i.test(btn.textContent.trim()) && btn.offsetParent !== null) {
        btn.click(); return;
      }
    }
  }).catch(() => {});

  return token.token;
}

// ======================== 单个邮箱注册 ========================
async function registerOne(browser, account) {
  const { email, password, clientId, refreshToken } = account;

  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  await page.setViewport(CONFIG.VIEWPORT);
  page.setDefaultTimeout(60000);

  // 注入 Turnstile 绕过
  await injectPatch(page);

  // 监听新标签页
  const targetHandler = async (target) => {
    try {
      const p = await target.page();
      if (p) {
        p.setDefaultTimeout(60000);
        await p.setViewport(CONFIG.VIEWPORT);
        await injectPatch(p);
      }
    } catch (e) {}
  };
  browser.on('targetcreated', targetHandler);

  try {
    // Step 1: Open signup page
    log("[1/8] Opening signup page...");
    await page.goto(CONFIG.SIGNUP_URL, { waitUntil: "networkidle2", timeout: 45000 });
    await sleep(3000);

    // Verify patch is active
    const patchActive = await page.evaluate(() => !!window.__CF_BYPASS__).catch(() => false);
    log("  Patch active: " + patchActive);

    // Step 2: Click "Email me a sign-up link"
    log("[2/8] Clicking 'Email me a sign-up link'...");
    let emailBtnClicked = false;
    for (let attempt = 0; attempt < 5; attempt++) {
      emailBtnClicked = await page.evaluate(() => {
        for (const btn of document.querySelectorAll("button")) {
          if (/Email me a sign-up link/i.test(btn.textContent)) { btn.click(); return true; }
        }
        return false;
      });
      if (emailBtnClicked) break;
      emailBtnClicked = await page.evaluate(() => {
        for (const el of document.querySelectorAll("button, a, div[role=button], span")) {
          if (/Email/i.test(el.textContent) && el.offsetParent !== null) { el.click(); return true; }
        }
        return false;
      });
      if (emailBtnClicked) break;
      await sleep(2000);
    }
    if (!emailBtnClicked) throw new Error("Cannot find 'Email me a sign-up link' button");
    await sleep(3000);

    // Step 3: Fill email -> Continue
    log("[3/8] Filling email: " + email);
    let emailInput = null;
    for (let i = 0; i < 15; i++) {
      emailInput = await page.$("input[type=email], input#email, input[name=email], input[placeholder*='email' i]");
      if (emailInput) break;
      await sleep(1500);
    }
    if (!emailInput) emailInput = await page.$("input:not([type=hidden]):not([type=submit]):not([type=button])");
    if (!emailInput) throw new Error("Email input not found");

    await emailInput.click({ clickCount: 3 }); await sleep(200);
    await emailInput.type(email, { delay: 30 + Math.floor(Math.random() * 30) }); await sleep(500);

    const typedValue = await emailInput.evaluate(e => e.value).catch(() => "");
    if (typedValue !== email) {
      await fillInputValue(page, "input[type=email], input#email", email);
      await sleep(500);
    }

    let contResult = await clickButtonByText(page, "^Continue$");
    if (!contResult) {
      await page.evaluate(() => {
        const btn = document.querySelector('button[type=submit]') || document.querySelector('input[type=submit]');
        if (btn) btn.click();
      });
    }
    await sleep(4000);

    let pageText = await getBodyText(page, 400);
    if (!/check your email|login link|we sent|check your inbox/i.test(pageText)) {
      log("  Page text: " + pageText.substring(0, 120));
      await clickButtonByText(page, "^Continue$|^Send$|^Send Link$");
      await sleep(4000);
      pageText = await getBodyText(page, 300);
      if (!/check your email|login link|we sent/i.test(pageText)) {
        throw new Error("Email send may have failed: " + pageText.substring(0, 80));
      }
    }

    // Subtract 10s buffer for Graph API receivedDateTime vs local time difference
    const sendTime = new Date(Date.now() - 10000);
    log("[OK] Email sent at " + new Date().toISOString());

    // Step 4: Poll inbox for magic link
    log("[4/8] Polling inbox for magic link...");
    const result = await pollMagicLink(clientId, refreshToken, sendTime);
    if (!result) throw new Error("Magic link not found in 3 minutes");
    const link = result.link;
    const newRefreshToken = result.newRefreshToken;
    log("[OK] Got magic link: " + link.substring(0, 80) + "...");

    if (newRefreshToken !== refreshToken) {
      const content = [email, password, clientId, newRefreshToken].join("----");
      writeFileSync(join(CONFIG.EMAIL_DIR, email + ".txt"), content, "utf-8");
    }

    // Step 5: Open magic link
    log("[5/8] Opening magic link...");
    try {
      await page.goto(link, { waitUntil: "domcontentloaded", timeout: 60000 });
    } catch (navErr) {
      if (/timeout/i.test(navErr.message)) {
        log("  Nav timeout (expected for Turnstile), continuing...");
      } else if (/net::ERR_/i.test(navErr.message)) {
        throw new Error("Network error: " + navErr.message);
      } else {
        log("  Nav error: " + navErr.message + ", continuing...");
      }
    }
    await sleep(3000);

    // Step 5b: Wait for Turnstile verification
    log("  Waiting for Turnstile/redirect...");
    let reachedHandlePage = false;
    let lastResetTime = 0;
    const initialUrl = page.url();

    for (let i = 0; i < 40; i++) {
      let bodyText = await getBodyText(page, 600);
      const currentUrl = page.url();

      // Check handle page
      if (/choose your handle|pick your handle|select.*handle/i.test(bodyText)) {
        log("  Reached handle page!");
        reachedHandlePage = true;
        break;
      }

      // Check dashboard redirect
      if (/dashboard|account|home|welcome|settings/i.test(currentUrl) && !/verify|login|signup/i.test(currentUrl)) {
        log("  Redirected to dashboard!");
        reachedHandlePage = true;
        break;
      }

      // Check expired link FIRST (before redirecting check!)
      if (/invalid.*expired|expired.*invalid|link.*expir/i.test(bodyText)) {
        // But also check if we're on handle page (expired message might be in header/footer)
        if (!/choose your handle/i.test(bodyText)) {
          throw new Error("Magic link expired or already used");
        }
      }

      // Check URL changed (Turnstile passed, page redirected)
      if (i > 0 && currentUrl !== initialUrl) {
        log("  URL changed to: " + currentUrl.substring(0, 80));
        // Wait a bit for the page to fully load
        await sleep(5000);
        bodyText = await getBodyText(page, 600);
        if (/choose your handle|pick your handle/i.test(bodyText)) {
          log("  Reached handle page after redirect!");
          reachedHandlePage = true;
          break;
        }
        if (/dashboard|account|home|welcome/i.test(currentUrl)) {
          log("  Redirected to dashboard!");
          reachedHandlePage = true;
          break;
        }
      }

      // Check for redirecting state
      if (/redirecting|hang tight|finish signing/i.test(bodyText)) {
        log("  Page shows redirecting, waiting for URL change...");
        await sleep(8000);
        const newUrl = page.url();
        if (newUrl !== currentUrl) {
          log("  URL changed! " + newUrl.substring(0, 80));
        }
        continue;
      }

      // Try to get Turnstile token
      const tsResult = await tryGetTurnstileToken(page);
      if (tsResult.ok) {
        log("  [Turnstile] Token obtained! method=" + tsResult.method + " len=" + tsResult.len);
        await sleep(3000);
        continue;
      }

      // Reset Turnstile every 15s
      const isTurnstile = /verifying|browser check|checking|challenge|turnstile/i.test(bodyText);
      if (isTurnstile && Date.now() - lastResetTime > 15000) {
        await tryResetTurnstile(page);
        lastResetTime = Date.now();
        log("  [Turnstile] Reset, waiting for re-verify...");
      }

      // Try clicking "Continue in browser" (limit to 3 clicks)
      if (i < 3) {
        const clickedContinue = await page.evaluate(() => {
          for (const el of document.querySelectorAll("button, a, div[role=button], span")) {
            if (/continue in browser/i.test(el.textContent.trim()) && el.offsetParent !== null) {
              el.click(); return el.textContent.trim();
            }
          }
          return false;
        }).catch(() => false);

        if (clickedContinue) {
          log("  Clicked: " + clickedContinue);
          await sleep(8000);
          continue;
        }
      }

      if (i > 0 && i % 5 === 0) log("  Still waiting... [" + (i * 3) + "s]");
      await sleep(3000);
    }

    if (!reachedHandlePage) {
      const finalTxt = await getBodyText(page, 300);
      if (/choose your handle/i.test(finalTxt)) {
        reachedHandlePage = true;
      } else {
        await page.screenshot({ path: join(CONFIG.REGISTERED_DIR, "debug_turnstile_fail.png") }).catch(() => {});
        throw new Error("Failed to reach handle page: " + finalTxt.substring(0, 80));
      }
    }

    // Step 6: Set handle
    log("[6/8] Setting handle...");
    let handleInput = null;
    for (let i = 0; i < 20; i++) {
      handleInput = await page.$("input[placeholder='you']") || await page.$("input[type=text]") || await page.$("input:not([type=hidden]):not([type=submit])");
      if (handleInput) break;
      await sleep(2000);
    }
    if (!handleInput) throw new Error("Handle input not found");

    const handle = "user" + Math.random().toString(36).substring(2, 8);
    log("  Handle: " + handle);
    await handleInput.click({ clickCount: 3 }); await sleep(200);
    await handleInput.type(handle, { delay: 30 + Math.floor(Math.random() * 30) }); await sleep(1000);

    await clickButtonByText(page, "^Continue$");
    await sleep(5000);

    // Step 7: Wait for boot -> Go to your Zo
    log("[7/8] Waiting for computer to boot...");
    for (let i = 1; i <= 60; i++) {
      await sleep(5000);
      const bodyText = await getBodyText(page, 400);

      if (/go to your zo/i.test(bodyText)) {
        log("  Boot complete! Clicking 'Go to your Zo'...");
        await clickButtonByText(page, "go to your zo");
        await sleep(8000);
        const finalUrl = page.url();
        log("[OK] Final URL: " + finalUrl);

        // Step 8: 自动获取 ZO Access Token
        let accessToken = null;
        try {
          accessToken = await getZoAccessToken(page, email, handle);
          if (accessToken) {
            log("[OK] Access Token obtained for " + email);
          } else {
            log("[WARN] Failed to get Access Token for " + email);
          }
        } catch (tokenErr) {
          log("[WARN] Token retrieval error: " + tokenErr.message);
        }

        const regResult = {
          email: email, handle: handle, url: finalUrl,
          zoAddress: handle + ".zo.computer",
          accessToken: accessToken || null,
          time: new Date().toISOString(), status: "success"
        };
        appendFileSync(CONFIG.RESULTS_FILE, JSON.stringify(regResult) + "\n");

        // 如果有 token，额外保存到凭证文件
        if (accessToken) {
          try {
            const tokenFile = join(CONFIG.REGISTERED_DIR, "tokens_" + email + ".txt");
            writeFileSync(tokenFile, "email: " + email + "\nhandle: " + handle + "\nzoAddress: " + handle + ".zo.computer\naccessToken: " + accessToken + "\ntime: " + new Date().toISOString() + "\n", "utf-8");
            log("  Token saved to: " + tokenFile);
          } catch (e) {
            log("  [WARN] Failed to save token file: " + e.message);
          }
        }

        try { renameSync(join(CONFIG.EMAIL_DIR, email + ".txt"), join(CONFIG.REGISTERED_DIR, email + ".txt")); } catch (e) {}

        await context.close();
        browser.off('targetcreated', targetHandler);
        return regResult;
      }

      if (/invalid|expired|something went wrong/i.test(bodyText) && !/booting|starting|%/i.test(bodyText)) {
        throw new Error("Boot failed: " + bodyText.substring(0, 100));
      }

      const pct = bodyText.match(/(\d+\.?\d*)%/);
      if (pct && i % 3 === 0) log("  Boot: " + pct[1] + "%");
    }

    throw new Error("Boot timeout (300s)");

  } catch (err) {
    await page.screenshot({ path: join(CONFIG.REGISTERED_DIR, "debug_" + Date.now() + ".png") }).catch(() => {});
    await context.close();
    browser.off('targetcreated', targetHandler);
    throw err;
  }
}

// ======================== 主流程 ========================
async function main() {
  const args = process.argv.slice(2);
  const countIdx = args.indexOf("--count");
  const maxCount = countIdx >= 0 ? parseInt(args[countIdx + 1]) : Infinity;

  log("=== ZO Computer Register (Optimized v3) ===");
  log("Email dir: " + CONFIG.EMAIL_DIR);

  await ensureChromeRunning();

  let browser;
  try {
    browser = await puppeteer.connect({
      browserURL: "http://localhost:" + CONFIG.CDP_PORT,
      defaultViewport: null,
      timeout: 10000,
    });
    log("Connected to browser (CDP port " + CONFIG.CDP_PORT + ")");
  } catch (e) {
    log("[ERROR] Cannot connect: " + e.message);
    process.exit(1);
  }

  const files = readdirSync(CONFIG.EMAIL_DIR).filter(f =>
    f.endsWith(".txt") && !f.startsWith("tokens_") && !f.startsWith("merged_") &&
    !f.startsWith("probe") && !f.startsWith("combo") && !f.startsWith("used_")
  );

  if (files.length === 0) { log("No email files found"); browser.disconnect(); return; }
  log("Found " + files.length + " email files");

  const registered = new Set();
  try {
    if (existsSync(CONFIG.RESULTS_FILE)) {
      const lines = readFileSync(CONFIG.RESULTS_FILE, "utf-8").trim().split("\n");
      for (const line of lines) {
        try { const r = JSON.parse(line); if (r.status === "success") registered.add(r.email); } catch (e) {}
      }
    }
  } catch (e) {}

  const pending = files.filter(f => {
    try {
      const content = readFileSync(join(CONFIG.EMAIL_DIR, f), "utf-8").trim();
      return !registered.has(content.split("----")[0]);
    } catch { return false; }
  }).slice(0, maxCount);

  log("Already registered: " + registered.size + " | Pending: " + pending.length);
  if (pending.length === 0) { log("Nothing to register"); browser.disconnect(); return; }

  let success = 0, fail = 0;

  for (let idx = 0; idx < pending.length; idx++) {
    const file = pending[idx];
    let content;
    try { content = readFileSync(join(CONFIG.EMAIL_DIR, file), "utf-8").trim(); } catch (e) { continue; }

    const parts = content.split("----").map(s => s.trim());
    if (parts.length < 4) { log("[SKIP] Bad format: " + file); continue; }

    const [email, password, clientId, refreshToken] = parts;
    log("");
    log("====================================");
    log("[" + (idx + 1) + "/" + pending.length + "] Registering: " + email);

    try {
      const result = await registerOne(browser, { email, password, clientId, refreshToken });
      log("SUCCESS! Handle: " + result.handle + " | " + result.zoAddress);
      success++;
    } catch (e) {
      log("FAIL: " + e.message);
      appendFileSync(CONFIG.RESULTS_FILE, JSON.stringify({
        email: email, status: "fail", error: e.message, time: new Date().toISOString()
      }) + "\n");
      fail++;
    }

    if (idx < pending.length - 1) {
      const delay = 3000 + Math.floor(Math.random() * 4000);
      log("Waiting " + Math.round(delay / 1000) + "s...");
      await sleep(delay);
    }
  }

  log("");
  log("====================================");
  log("Done! Success: " + success + " | Failed: " + fail + " | Total: " + pending.length);
  log("Results: " + CONFIG.RESULTS_FILE);
  browser.disconnect();
}

main().catch(e => { log("[FATAL] " + e.message); process.exit(1); });
