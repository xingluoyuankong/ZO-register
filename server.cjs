/**
 * ZO Computer Batch Register - Server v3
 * Uses puppeteer.launch() with pipe-mode CDP (undetectable by Turnstile)
 */
const express = require("express");
const http = require("http");
const { WebSocketServer } = require("ws");
const puppeteer = require("E:\\API获取工具\\ZO注册\\node_modules\\puppeteer-core");
const { readFileSync, writeFileSync, appendFileSync, readdirSync, renameSync, mkdirSync, existsSync, mkdtempSync, rmSync } = require("fs");
const { join } = require("path");
const os = require("os");
const { TURNSTILE_PATCH, TURNSTILE_GET_TOKEN, TURNSTILE_FILL_TOKEN } = require("./turnstile-patch");

// ========== Config ==========
const WEB_PORT = 3456;
const CONFIG_FILE = join(__dirname, "config.json");
const DEFAULT_EMAIL_DIR = "C:\\Users\\XZXyuan\\Downloads\\批量注册邮箱\\已经使用";

// Load or init config
let config = { emailDir: DEFAULT_EMAIL_DIR, browserType: "edge", nstApiKey: "75aea070-3456-4603-9a57-e9b8791de3c9", nstApiBase: "http://localhost:8848/api/v2" };
try {
  if (existsSync(CONFIG_FILE)) {
    const saved = JSON.parse(readFileSync(CONFIG_FILE, "utf-8"));
    if (saved.emailDir) config.emailDir = saved.emailDir;
    if (saved.browserType) config.browserType = saved.browserType;
    if (saved.nstApiKey) config.nstApiKey = saved.nstApiKey;
    if (saved.nstApiBase) config.nstApiBase = saved.nstApiBase;
  }
} catch (e) {}
let EMAIL_DIR = config.emailDir;

function saveConfig() {
  try { writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), "utf-8"); } catch (e) {}
}
const REGISTERED_DIR = "E:\\API获取工具\\ZO注册\\registered";
const RESULTS_FILE = join(REGISTERED_DIR, "results.jsonl");
const SIGNUP_URL = "https://www.zo.computer/signup";
const GRAPH_TOKEN_URL = "https://login.microsoftonline.com/consumers/oauth2/v2.0/token";
const GRAPH_MAIL_URL = "https://graph.microsoft.com/v1.0/me/messages";
const CHROME_PATH = "C:\\Users\\XZXyuan\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe";
const EDGE_PATH = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const DEFAULT_CONCURRENCY = 1;

if (!existsSync(REGISTERED_DIR)) mkdirSync(REGISTERED_DIR, { recursive: true });

// ========== State ==========
const state = {
  emails: [], running: false, concurrency: DEFAULT_CONCURRENCY,
  stats: { total: 0, pending: 0, success: 0, fail: 0, inProgress: 0 },
  workers: [],
};
const wsClients = new Set();

// ========== Utils ==========
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function broadcast(type, data) {
  const msg = JSON.stringify({ type, data, time: new Date().toISOString() });
  for (const ws of wsClients) { try { ws.send(msg); } catch (e) {} }
}
function updateStats() {
  state.stats.total = state.emails.length;
  state.stats.pending = state.emails.filter(e => e.status === "pending").length;
  state.stats.success = state.emails.filter(e => e.status === "success").length;
  state.stats.fail = state.emails.filter(e => e.status === "fail").length;
  state.stats.inProgress = state.emails.filter(e => e.status === "registering").length;
  broadcast("stats", state.stats);
}
function setEmailStatus(email, status, extra = {}) {
  const item = state.emails.find(e => e.email === email);
  if (item) { item.status = status; Object.assign(item, extra); updateStats(); broadcast("email_update", { email, status, ...extra }); }
}

// ========== Safe page helpers ==========
async function safeEval(page, fn, ...args) {
  for (let i = 0; i < 3; i++) {
    try { return await page.evaluate(fn, ...args); }
    catch (e) { if (/detached|navigation/i.test(e.message) && i < 2) { await sleep(2000); continue; } throw e; }
  }
}
async function getBodyText(page, len) {
  len = len || 500;
  try { return await page.evaluate((l) => document.body.innerText.substring(0, l), len); } catch (e) { return ""; }
}
async function waitForText(page, regex, timeoutMs) {
  timeoutMs = timeoutMs || 30000;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const txt = await getBodyText(page);
    if (regex.test(txt)) return txt;
    await sleep(2000);
  }
  return null;
}

// ========== Graph API ==========
async function getMailToken(clientId, refreshToken) {
  const body = new URLSearchParams({
    client_id: clientId, grant_type: "refresh_token", refresh_token: refreshToken,
    scope: "https://graph.microsoft.com/.default offline_access",
  });
  const resp = await fetch(GRAPH_TOKEN_URL, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: body.toString(),
  });
  const data = await resp.json();
  if (data.error) throw new Error("Token error: " + data.error_description);
  return { accessToken: data.access_token, newRefreshToken: data.refresh_token || refreshToken };
}
async function findMagicLink(accessToken, afterTime, log) {
  const url = GRAPH_MAIL_URL + "?$top=10&$select=subject,body,from,receivedDateTime&$orderby=receivedDateTime%20desc";
  const resp = await fetch(url, { headers: { Authorization: "Bearer " + accessToken } });
  const mail = await resp.json();
  if (!mail.value || mail.value.length === 0) { if (log) log("  [DEBUG] Inbox empty or API error"); return null; }
  if (log) log("  [DEBUG] Fetched " + mail.value.length + " emails, afterTime=" + afterTime.toISOString());
  
  for (const msg of mail.value) {
    const recvTime = new Date(msg.receivedDateTime);
    if (log) log("  [DEBUG] Email: " + msg.receivedDateTime + " from=" + ((msg.from||{}).emailAddress||{}).address + " sub=" + (msg.subject||"").substring(0,30));
    if (recvTime < afterTime) { if (log) log("  [DEBUG] Skipping (too old)"); continue; }
    
    const subject = msg.subject || "";
    const fromAddr = (msg.from && msg.from.emailAddress && msg.from.emailAddress.address) || "";
    const fromName = (msg.from && msg.from.emailAddress && msg.from.emailAddress.name) || "";
    const bodyContent = (msg.body && msg.body.content) || "";
    const combined = subject + " " + fromName + " " + fromAddr + " " + bodyContent;
    
    // 宽松匹配：zo.computer 相关邮件
    if (!/zo/i.test(combined)) continue;
    
    // 提取所有 zo.computer 链接
    const links = combined.match(/https?:\/\/[^\s"'<>]*zo\.computer[^\s"'<>]*/gi) || [];
    for (let link of links) {
      link = link.replace(/[)\]>,;!?\s]+$/, "").replace(/&amp;/g, "&");
      // 优先匹配带 token 的验证链接
      if (link.includes("token=") || link.includes("verify") || link.includes("login") || link.includes("sign")) {
        if (log) log("  [DEBUG] Found link: " + link.substring(0, 80));
        return link;
      }
    }
    
    // 兜底：提取任何带 token 参数的链接
    const allLinks = combined.match(/https?:\/\/[^\s"'<>]+/gi) || [];
    for (let link of allLinks) {
      link = link.replace(/[)\]>,;!?\s]+$/, "").replace(/&amp;/g, "&");
      if (link.includes("token=") && link.includes("zo")) {
        if (log) log("  [DEBUG] Found token link: " + link.substring(0, 80));
        return link;
      }
    }
    
    if (log) log("  [DEBUG] Email from: " + fromAddr + " sub: " + subject.substring(0, 40) + " - no matching link");
  }
  return null;
}
async function pollMagicLink(email, clientId, refreshToken, afterTime, log) {
  let rt = refreshToken;
  const deadline = Date.now() + 180000;
  while (Date.now() < deadline) {
    try {
      const { accessToken, newRefreshToken } = await getMailToken(clientId, rt);
      rt = newRefreshToken;
      const link = await findMagicLink(accessToken, afterTime, log);
      if (link) return { link, newRefreshToken: rt };
    } catch (e) { log("Poll error: " + e.message); }
    process.stdout.write(".");
    await sleep(3000);
  }
  return null;
}

// ========== Nstbrowser API ==========
async function nstApi(path, method, body) {
  const opts = {
    method: method || "GET",
    headers: { "x-api-key": config.nstApiKey, "Content-Type": "application/json" }
  };
  if (body) opts.body = JSON.stringify(body);
  const r = await fetch(config.nstApiBase + path, opts);
  return r.json();
}

async function nstCreateProfile(name, proxy) {
  const body = { name: name || "zo-" + Date.now(), platform: "Windows" };
  if (proxy) body.proxy = proxy;
  const r = await nstApi("/profiles", "POST", body);
  if (r.err) throw new Error("Nstbrowser create profile failed: " + r.msg);
  return r.data;
}

async function nstStartProfile(profileId) {
  const r = await nstApi("/browsers/" + profileId, "POST");
  if (r.err) throw new Error("Nstbrowser start failed: " + r.msg);
  return r.data; // { port, profileId, proxy, webSocketDebuggerUrl }
}

async function nstStopProfile(profileId) {
  try { await nstApi("/browsers/" + profileId, "DELETE"); } catch (e) {}
}

async function nstDeleteProfile(profileId) {
  try { await nstApi("/profiles/" + profileId, "DELETE"); } catch (e) {}
}

async function nstListProfiles() {
  const r = await nstApi("/profiles?limit=100");
  if (r.err) throw new Error("Nstbrowser list failed: " + r.msg);
  return r.data;
}

// ========== Register one email ==========
async function registerOne(emailItem) {
  const { email, password, clientId, refreshToken } = emailItem;
  const log = (msg) => { broadcast("log", { email, msg }); console.log("[" + email.substring(0, 20) + "] " + msg); };

  let browser, nstProfileId, tempDir;
  const bt = config.browserType || "chrome";

  try {
    if (bt === "nstbrowser") {
      // Nstbrowser: 创建 profile → 启动 → 获取 CDP 连接
      log("[BROWSER] Creating Nstbrowser profile...");
      const profile = await nstCreateProfile("zo-" + email.split("@")[0]);
      nstProfileId = profile._id || profile.profileId;
      log("[BROWSER] Profile created: " + nstProfileId);

      log("[BROWSER] Starting profile...");
      const started = await nstStartProfile(nstProfileId);
      log("[BROWSER] CDP: " + (started.webSocketDebuggerUrl || "none"));
      if (!started.webSocketDebuggerUrl) throw new Error("Nstbrowser no webSocketDebuggerUrl");

      browser = await puppeteer.connect({
        browserWSEndpoint: started.webSocketDebuggerUrl,
        defaultViewport: null,
      });
      log("[BROWSER] Connected to Nstbrowser");
    } else {
      // Chrome/Edge: 独立临时 user-data-dir + 无痕模式
      tempDir = mkdtempSync(join(os.tmpdir(), "zo_reg_"));
      const exePath = bt === "edge" ? EDGE_PATH : CHROME_PATH;
      const browserName = bt === "edge" ? "Edge" : "Chrome";

      browser = await puppeteer.launch({
        executablePath: exePath,
        headless: false,
        protocolTimeout: 300000,
        userDataDir: tempDir,
        args: [
          "--no-first-run",
          "--no-default-browser-check",
          "--disable-default-apps",
          "--disable-features=Translate",
          "--disable-blink-features=AutomationControlled",
          "--window-size=1440,900",
          "--incognito",
          "--disk-cache-size=0",
          "--disable-save-password-bubble",
          "--disable-password-generation",
          "--password-store=basic",
          "--disable-sync",
          "--disable-client-side-phishing-detection",
          "--disable-background-networking",
          "--disable-background-timer-throttling",
          "--disable-backgrounding-occluded-windows",
          "--disable-renderer-backgrounding",
          "--disable-hang-monitor",
          "--disable-gpu",
          "--disable-software-rasterizer",
          "--disable-dev-shm-usage",
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-component-update",
          "--metrics-recording-only",
          "--no-pings",
          "--disable-extensions",
          "--disable-plugins-discovery",
          "--disable-infobars",
        ],
        defaultViewport: { width: 1440, height: 900 },
        ignoreDefaultArgs: ["--enable-automation"],
      });
      log("[BROWSER] " + browserName + " fresh profile: " + tempDir);
    }

    const pages = await browser.pages();
    const page = pages.length > 0 ? pages[0] : await browser.newPage();
    page.setDefaultTimeout(60000);
    await page.setViewport({ width: 1440, height: 900 });

    // 高级 Stealth patches — 消除自动化痕迹 + Turnstile 绕过
    await page.evaluateOnNewDocument(() => {
      // ★ Cloudflare Turnstile 绕过：劫持 screenX/screenY
      if (!window.__TURNSTILE_PATCHED__) {
        window.__TURNSTILE_PATCHED__ = true;
        var _offX = Math.floor(Math.random() * 121) + 80;
        var _offY = Math.floor(Math.random() * 91) + 60;
        try { Object.defineProperty(MouseEvent.prototype, 'screenX', { get: function() { return (this.clientX||0) + _offX; }, configurable: true }); } catch(e) {}
        try { Object.defineProperty(MouseEvent.prototype, 'screenY', { get: function() { return (this.clientY||0) + _offY; }, configurable: true }); } catch(e) {}
        try { Object.defineProperty(PointerEvent.prototype, 'screenX', { get: function() { return (this.clientX||0) + _offX; }, configurable: true }); } catch(e) {}
        try { Object.defineProperty(PointerEvent.prototype, 'screenY', { get: function() { return (this.clientY||0) + _offY; }, configurable: true }); } catch(e) {}
      }
      // 移除 webdriver 标记
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
      // 伪造插件列表
      Object.defineProperty(navigator, 'plugins', {
        get: () => {
          const plugins = [
            { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
            { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai', description: '' },
            { name: 'Native Client', filename: 'internal-nacl-plugin', description: '' },
          ];
          plugins.length = 3;
          return plugins;
        }
      });
      Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
      Object.defineProperty(navigator, 'language', { get: () => 'en-US' });
      // 伪造 chrome 对象
      window.chrome = { runtime: {}, loadTimes: function(){}, csi: function(){} };
      // 移除 CDC 标记
      delete window.cdc_adoQpoasnfa76pfcZLmcfl_Array;
      delete window.cdc_adoQpoasnfa76pfcZLmcfl_Promise;
      delete window.cdc_adoQpoasnfa76pfcZLmcfl_Symbol;
      // 伪造 permissions
      const originalQuery = window.navigator.permissions.query;
      window.navigator.permissions.query = (parameters) => (
        parameters.name === 'notifications' ?
          Promise.resolve({ state: Notification.permission }) :
          originalQuery(parameters)
      );
      // 伪造 connection
      Object.defineProperty(navigator, 'connection', {
        get: () => ({ rtt: 50, downlink: 10, effectiveType: '4g', saveData: false })
      });
      // 伪造 hardwareConcurrency
      Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8 });
      // 伪造 deviceMemory
      Object.defineProperty(navigator, 'deviceMemory', { get: () => 8 });
    });

    browser.on('targetcreated', async (target) => {
      const p = await target.page().catch(() => null);
      if (!p) return;
      await p.evaluateOnNewDocument(() => {
        // ★ Turnstile 绕过：劫持 screenX/screenY
        if (!window.__TURNSTILE_PATCHED__) {
          window.__TURNSTILE_PATCHED__ = true;
          var _offX = Math.floor(Math.random() * 121) + 80;
          var _offY = Math.floor(Math.random() * 91) + 60;
          try { Object.defineProperty(MouseEvent.prototype, 'screenX', { get: function() { return (this.clientX||0) + _offX; }, configurable: true }); } catch(e) {}
          try { Object.defineProperty(MouseEvent.prototype, 'screenY', { get: function() { return (this.clientY||0) + _offY; }, configurable: true }); } catch(e) {}
          try { Object.defineProperty(PointerEvent.prototype, 'screenX', { get: function() { return (this.clientX||0) + _offX; }, configurable: true }); } catch(e) {}
          try { Object.defineProperty(PointerEvent.prototype, 'screenY', { get: function() { return (this.clientY||0) + _offY; }, configurable: true }); } catch(e) {}
        }
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
        Object.defineProperty(navigator, 'plugins', {
          get: () => {
            const plugins = [
              { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
              { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai', description: '' },
              { name: 'Native Client', filename: 'internal-nacl-plugin', description: '' },
            ];
            plugins.length = 3;
            return plugins;
          }
        });
        Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
        window.chrome = { runtime: {}, loadTimes: function(){}, csi: function(){} };
        delete window.cdc_adoQpoasnfa76pfcZLmcfl_Array;
        delete window.cdc_adoQpoasnfa76pfcZLmcfl_Promise;
        delete window.cdc_adoQpoasnfa76pfcZLmcfl_Symbol;
      });
    });

    const result = await registerOneWithBrowser(browser, page, emailItem, log);
    return result;
  } catch (e) {
    log("FAILED: " + e.message);
    throw e;
  } finally {
    // 清理
    if (bt === "nstbrowser" && nstProfileId) {
      try { await nstStopProfile(nstProfileId); } catch (e) {}
      try { await nstDeleteProfile(nstProfileId); } catch (e) {}
      log("[BROWSER] Nstbrowser profile cleaned up");
    } else if (browser) {
      try { await browser.close(); } catch (e) {}
      if (tempDir) try { rmSync(tempDir, { recursive: true, force: true }); } catch (e) {}
      log("[BROWSER] Cleaned up");
    }
  }
}

async function registerOneWithBrowser(browser, page, emailItem, log) {
  const { email, password, clientId, refreshToken } = emailItem;
  try {
    // Notify frontend: registering
    setEmailStatus(email, "registering");

    // Step 1: Open signup
    log("[1/7] Opening signup...");
    await page.goto(SIGNUP_URL, { waitUntil: "domcontentloaded", timeout: 45000 });
    await sleep(2000);
    const signupReady = await waitForText(page, /sign\s*up|email\s*me|continue/i, 30000);
    if (!signupReady) throw new Error("Signup page did not load");

    // Step 2: Click "Email me a sign-up link"
    log("[2/7] Clicking email button...");
    let clicked = false;
    for (let attempt = 0; attempt < 3 && !clicked; attempt++) {
      for (const sel of ["button", "a", "div[role=button]"]) {
        const els = await page.$$(sel);
        for (const el of els) {
          const txt = await el.evaluate(e => e.textContent).catch(() => "");
          if (/Email me a sign-up link/i.test(txt)) { await el.click(); clicked = true; break; }
        }
        if (clicked) break;
      }
      if (!clicked) await sleep(2000);
    }
    if (!clicked) throw new Error("Cannot find 'Email me a sign-up link' button");
    await sleep(2000);

    // Step 3: Fill email + Continue
    log("[3/7] Filling email: " + email);
    let emailInput = null;
    for (let i = 0; i < 15; i++) {
      emailInput = await page.$("input[type=email], input#email, input[name=email]");
      if (!emailInput) {
        const allInputs = await page.$$("input");
        for (const inp of allInputs) {
          const ph = await inp.evaluate(e => (e.placeholder || "") + " " + (e.type || "")).catch(() => "");
          if (/email/i.test(ph)) { emailInput = inp; break; }
        }
      }
      if (emailInput) break;
      await sleep(2000);
    }
    if (!emailInput) throw new Error("Email input not found");

    await emailInput.click({ clickCount: 3 }); await sleep(200);
    await emailInput.type(email, { delay: 30 }); await sleep(500);

    const typedValue = await emailInput.evaluate(e => e.value).catch(() => "");
    if (typedValue !== email) {
      log("  Input value mismatch, using setter...");
      await page.evaluate((sel, val) => {
        const inp = document.querySelector("input[type=email]") || document.querySelector("input#email") || document.querySelector("input[name=email]");
        if (!inp) return;
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
        setter.call(inp, val);
        inp.dispatchEvent(new Event("input", { bubbles: true }));
        inp.dispatchEvent(new Event("change", { bubbles: true }));
      }, null, email);
      await sleep(500);
    }

    const btns = await page.$$("button");
    for (const btn of btns) {
      const txt = await btn.evaluate(e => e.textContent.trim()).catch(() => "");
      if (/^Continue$/i.test(txt)) { await btn.click(); break; }
    }
    await sleep(4000);

    const pageText = await getBodyText(page, 400);
    log("  After continue: " + pageText.substring(0, 80));
    if (!/check your email|login link|we sent/i.test(pageText)) {
      if (/continue|back/i.test(pageText) && !/check/i.test(pageText)) {
        log("  Page still shows form, retrying Continue...");
        const retryBtns = await page.$$("button");
        for (const btn of retryBtns) {
          const txt = await btn.evaluate(e => e.textContent.trim()).catch(() => "");
          if (/^Continue$/i.test(txt)) { await btn.click(); break; }
        }
        await sleep(4000);
        const retryText = await getBodyText(page, 300);
        if (!/check your email|login link|we sent/i.test(retryText)) {
          throw new Error("Email send failed: " + retryText.substring(0, 60));
        }
      } else {
        throw new Error("Email send failed: " + pageText.substring(0, 60));
      }
    }

    const sendTime = new Date(Date.now() - 3000); // 3s buffer
    log("[4/7] Email sent! Polling inbox...");

    // Step 4: Poll for magic link
    const result = await pollMagicLink(email, clientId, refreshToken, sendTime, log);
    if (!result) throw new Error("No magic link in 3 min");
    const { link, newRefreshToken } = result;
    log("  Got magic link!");

    if (newRefreshToken !== refreshToken) {
      writeFileSync(join(EMAIL_DIR, email + ".txt"), [email, password, clientId, newRefreshToken].join("----"), "utf-8");
    }

    // Step 5: Open magic link
    // 清除当前页面状态，用新上下文打开链接
    log("[5/7] Opening magic link...");
    log("  Link: " + link.substring(0, 80));

    // 清除 cookies 和缓存，确保干净的请求
    const client = await page.target().createCDPSession();
    try { await client.send("Network.clearBrowserCookies"); } catch (e) {}
    try { await client.send("Network.clearBrowserCache"); } catch (e) {}
    try { await client.detach(); } catch (e) {}

    // 导航到链接
    try {
      await page.goto(link, { waitUntil: "networkidle2", timeout: 60000 });
    } catch (navErr) {
      if (/timeout/i.test(navErr.message)) {
        log("  Navigation timeout, continuing...");
      } else if (/net::ERR_/i.test(navErr.message)) {
        throw new Error("Network error opening link: " + navErr.message);
      } else {
        log("  Nav error: " + navErr.message + ", continuing...");
      }
    }
    await sleep(2000);

    // Step 5b: Wait for Turnstile → "Continue in browser" → handle page
    log("  Waiting for Turnstile/redirect...");
    let reachedHandlePage = false;
    let clickedContinueOnce = false;
    let seenRedirecting = false;
    const startUrl = page.url();
    for (let i = 0; i < 60; i++) {
      const txt = await getBodyText(page, 600);
      const currentUrl = page.url();

      if (/choose your handle/i.test(txt) || (currentUrl.includes("/signup") && /handle/i.test(txt))) {
        log("  Reached handle page!");
        reachedHandlePage = true;
        break;
      }

      if (/invalid|expired/i.test(txt) && !/redirecting|verif/i.test(txt)) {
        throw new Error("Link expired after click");
      }

      // After clicking, wait for URL to actually change (redirect)
      if (clickedContinueOnce && seenRedirecting) {
        // If URL changed from verify page → redirect happened
        if (currentUrl !== startUrl && !currentUrl.includes("email-login/verify")) {
          log("  URL changed to: " + currentUrl);
          await sleep(3000);
          const afterRedirect = await getBodyText(page, 400);
          if (/choose your handle/i.test(afterRedirect)) {
            log("  Reached handle page after redirect!");
            reachedHandlePage = true;
            break;
          }
          log("  After redirect: " + afterRedirect.substring(0, 60).replace(/\n/g, " "));
          seenRedirecting = false; // Reset, new page state
          continue;
        }
        // Still on same page with Redirecting... just wait
        if (/redirecting/i.test(txt)) {
          if (i % 5 === 0) log("  [" + i * 3 + "s] Waiting for redirect...");
          await sleep(3000);
          continue;
        }
      }

      // Check Turnstile status before clicking
      // ★ 主动通过 turnstile API 获取令牌
      const turnstileResult = await page.evaluate(() => {
        // 方法1: turnstile.getResponse() API
        try {
          if (typeof turnstile !== 'undefined') {
            const res = turnstile.getResponse();
            if (res) {
              // 填入隐藏字段
              const input = document.querySelector('input[name="cf-turnstile-response"]');
              if (input) {
                const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
                setter.call(input, res);
                input.dispatchEvent(new Event('change', { bubbles: true }));
              }
              return { status: 'ready', tokenLen: res.length };
            }
          }
        } catch (e) {}

        // 方法2: 检查隐藏字段是否已有值
        try {
          const input = document.querySelector('input[name="cf-turnstile-response"]');
          if (input && input.value) return { status: 'ready', tokenLen: input.value.length };
        } catch (e) {}

        // 方法3: 检查 iframe
        const iframes = document.querySelectorAll('iframe[src*="turnstile"], iframe[src*="challenges"]');
        if (iframes.length === 0) return { status: 'no_iframe' };
        for (const iframe of iframes) {
          try {
            const doc = iframe.contentDocument;
            if (doc) {
              const checked = doc.querySelector('[data-checked]');
              if (checked) return { status: 'checked' };
            }
          } catch(e) {}
        }
        return { status: 'pending' };
      }).catch(() => ({ status: 'unknown' }));

      const turnstileStatus = turnstileResult.status;
      if (turnstileResult.tokenLen) {
        log("  [Turnstile] Token obtained! len=" + turnstileResult.tokenLen);
      }

      if (i % 5 === 0) log("  [" + i * 3 + "s] Turnstile: " + turnstileStatus + " | " + txt.substring(0, 50).replace(/\n/g, " "));

      // ★ 主动 reset Turnstile 并等待令牌（当状态为 pending 时）
      if (turnstileStatus === 'pending' && i > 0 && i % 3 === 0) {
        const resetResult = await page.evaluate(() => {
          try {
            if (typeof turnstile !== 'undefined') {
              turnstile.reset();
              // 等待一小段时间让 PoW 完成
              return new Promise((resolve) => {
                let attempts = 0;
                const check = () => {
                  attempts++;
                  try {
                    const res = turnstile.getResponse();
                    if (res) {
                      const input = document.querySelector('input[name="cf-turnstile-response"]');
                      if (input) {
                        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
                        setter.call(input, res);
                        input.dispatchEvent(new Event('change', { bubbles: true }));
                      }
                      resolve('got_token');
                      return;
                    }
                  } catch (e) {}
                  if (attempts < 10) { setTimeout(check, 1000); } else { resolve('timeout'); }
                };
                setTimeout(check, 2000);
              });
            }
          } catch (e) {}
          return 'no_turnstile';
        }).catch(() => 'error');
        if (resetResult === 'got_token') {
          log("  [Turnstile] Token obtained via turnstile.reset()+getResponse()!");
        }
      }

      // Click "Continue in browser" if not already clicked or if turnstile is ready
      if (!clickedContinueOnce) {
        const clickedContinue = await page.evaluate(() => {
          for (const el of document.querySelectorAll("button, a, div[role=button], span")) {
            const text = el.textContent.trim();
            if (/Continue in browser/i.test(text) && el.offsetParent !== null) {
              el.click();
              return true;
            }
          }
          return false;
        }).catch(() => false);

        if (clickedContinue) {
          log("  Clicked 'Continue in browser' (turnstile=" + turnstileStatus + ")");
          clickedContinueOnce = true;
          await sleep(5000);
          const afterTxt = await getBodyText(page, 300);
          if (/choose your handle/i.test(afterTxt)) {
            log("  Reached handle page after continue!");
            reachedHandlePage = true;
            break;
          }
          if (/redirecting/i.test(afterTxt)) {
            seenRedirecting = true;
            log("  Page redirecting, waiting...");
          }
          continue;
        }
      }

      if (/redirecting/i.test(txt)) {
        seenRedirecting = true;
        log("  Redirecting...");
        await sleep(3000);
        continue;
      }

      await sleep(3000);
    }

    if (!reachedHandlePage) {
      const finalTxt = await getBodyText(page, 300);
      if (/choose your handle/i.test(finalTxt)) {
        reachedHandlePage = true;
      } else {
        throw new Error("Failed to reach handle page: " + finalTxt.substring(0, 80));
      }
    }

    // Step 6: Choose handle
    log("[6/7] Setting handle...");
    let handleInput = null;
    for (let i = 0; i < 20; i++) {
      handleInput = await page.$("input[placeholder='you']");
      if (!handleInput) handleInput = await page.$("input[type=text]");
      if (!handleInput) handleInput = await page.$("input:not([type=hidden]):not([type=submit])");
      if (handleInput) break;
      const txt = await getBodyText(page, 200);
      if (/invalid|expired/i.test(txt) && !/choose|handle/i.test(txt)) throw new Error("Link expired at handle page");
      await sleep(2000);
    }
    if (!handleInput) throw new Error("Handle input not found");

    const handle = "user" + Math.random().toString(36).substring(2, 8);
    log("  Handle: " + handle);
    await handleInput.click({ clickCount: 3 }); await sleep(200);
    await handleInput.type(handle, { delay: 30 }); await sleep(1000);

    const handleBtns = await page.$$("button");
    for (const btn of handleBtns) {
      const txt = await btn.evaluate(e => e.textContent.trim()).catch(() => "");
      if (/^Continue$/i.test(txt)) { await btn.click(); break; }
    }
    await sleep(5000);

    // Step 7: Boot → Go to your Zo
    log("[7/7] Waiting for boot...");
    for (let i = 1; i <= 50; i++) {
      await sleep(5000);
      const txt = await getBodyText(page, 400);
      if (/go to your zo/i.test(txt)) {
        log("  Boot complete! Clicking 'Go to your Zo'...");
        await page.evaluate(() => {
          for (const el of document.querySelectorAll("button, a, div[role=button]")) {
            if (/go to your zo/i.test(el.textContent.trim())) { el.click(); return; }
          }
        });
        await sleep(8000);
        const finalUrl = page.url();
        log("  SUCCESS! URL: " + finalUrl);
        try { renameSync(join(EMAIL_DIR, email + ".txt"), join(REGISTERED_DIR, email + ".txt")); } catch (e) {}
        return { handle, zoAddress: handle + ".zo.computer", url: finalUrl };
      }
      if (/invalid|expired|something went wrong/i.test(txt) && !/booting|starting|%/i.test(txt)) {
        throw new Error("Boot failed: " + txt.substring(0, 60));
      }
      const pct = txt.match(/(\d+\.?\d*)%/);
      if (pct && i % 3 === 0) { log("  Boot: " + pct[1] + "%"); setEmailStatus(email, "registering", { progress: pct[1] + "%" }); }
    }
    throw new Error("Boot timeout (250s)");

  } catch (e) {
    log("FAILED: " + e.message);
    throw e;
  }
  // 不在这里关闭浏览器，由 registerOne() 统一清理
}

// ========== Batch runner ==========
async function runBatch() {
  if (state.running) return;
  state.running = true;
  broadcast("batch_start", { concurrency: state.concurrency });

  const pending = state.emails.filter(e => e.status === "pending");
  if (pending.length === 0) { state.running = false; broadcast("batch_done", state.stats); return; }

  const queue = [...pending];

  async function runNext() {
    if (queue.length === 0 || !state.running) return;
    const emailItem = queue.shift();
    if (!emailItem || emailItem.status !== "pending") return;
    emailItem.status = "registering"; updateStats();

    const workerId = "W" + Date.now().toString(36);
    state.workers.push({ id: workerId, email: emailItem.email, status: "active" });
    broadcast("worker_update", state.workers);

    try {
      const result = await registerOne(emailItem);
      setEmailStatus(emailItem.email, "success", result);
      appendFileSync(RESULTS_FILE, JSON.stringify({ ...emailItem, ...result, time: new Date().toISOString() }) + "\n");
    } catch (e) {
      setEmailStatus(emailItem.email, "fail", { error: e.message });
      appendFileSync(RESULTS_FILE, JSON.stringify({ email: emailItem.email, status: "fail", error: e.message, time: new Date().toISOString() }) + "\n");
    }

    state.workers = state.workers.filter(w => w.id !== workerId);
    broadcast("worker_update", state.workers);
    if (state.running) await runNext();
  }

  const workers = [];
  for (let i = 0; i < Math.min(state.concurrency, queue.length); i++) workers.push(runNext());
  await Promise.all(workers);

  state.running = false;
  broadcast("batch_done", state.stats);
}

// ========== Express + WebSocket ==========
const app = express();
app.use(express.static(join(__dirname, "public")));
app.use(express.json());

app.get("/api/emails", (req, res) => {
  const files = existsSync(EMAIL_DIR) ? readdirSync(EMAIL_DIR).filter(f =>
    f.endsWith(".txt") && !f.startsWith("tokens_") && !f.startsWith("merged_") && !f.startsWith("probe") && !f.startsWith("combo")
  ) : [];
  state.emails = files.map(f => {
    const content = readFileSync(join(EMAIL_DIR, f), "utf-8").trim();
    const parts = content.split("----").map(s => s.trim());
    return { email: parts[0]||"", password: parts[1]||"", clientId: parts[2]||"", refreshToken: parts[3]||"", file: f, status: "pending", handle: "", error: "", progress: "" };
  }).filter(e => e.email && e.clientId && e.refreshToken);
  updateStats();
  res.json({ emails: state.emails, stats: state.stats });
});

app.post("/api/start", (req, res) => { if (state.running) return res.json({ ok: false, error: "already running" }); runBatch(); res.json({ ok: true }); });
app.post("/api/stop", (req, res) => { state.running = false; broadcast("batch_stop", {}); res.json({ ok: true }); });

// ========== Single Register ==========
app.post("/api/register-one", (req, res) => {
  const targetEmail = req.body && req.body.email;
  if (!targetEmail) return res.json({ ok: false, error: "未指定邮箱" });
  const item = state.emails.find(e => e.email === targetEmail);
  if (!item) return res.json({ ok: false, error: "找不到邮箱: " + targetEmail });
  if (item.status === "registering" || item.status === "success") return res.json({ ok: false, error: "该邮箱已在注册或已成功" });
  item.status = "pending";
  updateStats();
  // 异步启动单个注册
  (async () => {
    try {
      const result = await registerOne(item);
      setEmailStatus(item.email, "success", result);
      appendFileSync(RESULTS_FILE, JSON.stringify({ ...item, ...result, time: new Date().toISOString() }) + "\n");
    } catch (e) {
      setEmailStatus(item.email, "fail", { error: e.message });
      appendFileSync(RESULTS_FILE, JSON.stringify({ email: item.email, status: "fail", error: e.message, time: new Date().toISOString() }) + "\n");
    }
  })();
  res.json({ ok: true });
});
app.get("/api/status", (req, res) => { res.json({ running: state.running, stats: state.stats, workers: state.workers, concurrency: state.concurrency }); });
app.get("/api/registered", (req, res) => {
  const files = existsSync(REGISTERED_DIR) ? readdirSync(REGISTERED_DIR).filter(f => f.endsWith(".txt")) : [];
  const results = [];
  if (existsSync(RESULTS_FILE)) { const lines = readFileSync(RESULTS_FILE, "utf-8").trim().split("\n").filter(Boolean); for (const line of lines) { try { results.push(JSON.parse(line)); } catch (e) {} } }
  res.json({ files, results });
});
app.post("/api/concurrency", (req, res) => { state.concurrency = Math.max(1, Math.min(10, (req.body && req.body.concurrency) || 3)); res.json({ ok: true, concurrency: state.concurrency }); });

// ========== Email Dir API ==========
app.get("/api/email-dir", (req, res) => {
  res.json({ dir: EMAIL_DIR, exists: existsSync(EMAIL_DIR) });
});

app.post("/api/email-dir", (req, res) => {
  const newDir = req.body && req.body.dir;
  if (!newDir || typeof newDir !== "string") return res.json({ ok: false, error: "请提供文件夹路径" });
  const trimmed = newDir.trim();
  if (!existsSync(trimmed)) return res.json({ ok: false, error: "文件夹不存在: " + trimmed });
  EMAIL_DIR = trimmed;
  config.emailDir = trimmed;
  saveConfig();
  // Re-scan emails
  const files = readdirSync(EMAIL_DIR).filter(f =>
    f.endsWith(".txt") && !f.startsWith("tokens_") && !f.startsWith("merged_") && !f.startsWith("probe") && !f.startsWith("combo")
  );
  state.emails = files.map(f => {
    const content = readFileSync(join(EMAIL_DIR, f), "utf-8").trim();
    const parts = content.split("----").map(s => s.trim());
    return { email: parts[0]||"", password: parts[1]||"", clientId: parts[2]||"", refreshToken: parts[3]||"", file: f, status: "pending", handle: "", error: "", progress: "" };
  }).filter(e => e.email && e.clientId && e.refreshToken);
  updateStats();
  broadcast("emails_loaded", { emails: state.emails, stats: state.stats, dir: EMAIL_DIR });
  console.log("[INFO] Email dir changed to: " + EMAIL_DIR + " (" + state.emails.length + " emails)");
  res.json({ ok: true, dir: EMAIL_DIR, count: state.emails.length });
});

// ========== Browser Type API ==========
app.get("/api/browser-type", (req, res) => {
  res.json({ browserType: config.browserType, nstApiKey: config.nstApiKey ? "***" + config.nstApiKey.slice(-8) : "", nstApiBase: config.nstApiBase });
});

app.post("/api/browser-type", (req, res) => {
  const bt = req.body && req.body.browserType;
  if (bt !== "chrome" && bt !== "edge" && bt !== "nstbrowser") return res.json({ ok: false, error: "无效浏览器类型" });
  config.browserType = bt;
  if (req.body.nstApiKey) config.nstApiKey = req.body.nstApiKey;
  if (req.body.nstApiBase) config.nstApiBase = req.body.nstApiBase;
  saveConfig();
  res.json({ ok: true, browserType: config.browserType });
});

app.get("/api/nst-profiles", async (req, res) => {
  try {
    const data = await nstListProfiles();
    res.json({ ok: true, profiles: data.docs || [], total: data.totalDocs || 0 });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server });
wss.on("connection", (ws) => {
  wsClients.add(ws);
  ws.on("close", () => wsClients.delete(ws));
  ws.on("error", () => wsClients.delete(ws));
  ws.send(JSON.stringify({ type: "init", data: { stats: state.stats, workers: state.workers, running: state.running, concurrency: state.concurrency, emailDir: EMAIL_DIR, browserType: config.browserType } }));
});

function killPortAndStart() {
  const { execSync } = require("child_process");
  try {
    const out = execSync("netstat -ano | findstr \":" + WEB_PORT + "\" | findstr \"LISTENING\"", { encoding: "utf-8" });
    const match = out.match(/\s(\d+)\s*$/);
    if (match) { console.log("[INFO] Killing old process on port " + WEB_PORT + " (PID: " + match[1] + ")"); execSync("taskkill /PID " + match[1] + " /F", { stdio: "ignore" }); }
  } catch (e) {}
  server.listen(WEB_PORT, () => {
    console.log(""); console.log("  ZO Batch Register Server v3"); console.log("  Frontend: http://localhost:" + WEB_PORT); console.log("  Concurrency: " + state.concurrency); console.log("  Email dir: " + EMAIL_DIR); console.log("  Config: " + CONFIG_FILE); console.log("");
  });
}
killPortAndStart();

process.on("uncaughtException", (err) => { console.error("[ERROR]", err.message); });
process.on("unhandledRejection", (err) => { console.error("[ERROR]", err); });
