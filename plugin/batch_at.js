/**
 * batch_at.js — 批量获取已注册账号的 Access Token
 * 
 * 流程：
 * 1. 读取 zo.txt 凭证
 * 2. 检查哪些账号已有 AT
 * 3. 逐个登录 → 获取 AT
 * 4. 先单线程验证，再多线程并行
 */

// Global error handlers to catch unhandled rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('[FATAL] Unhandled Rejection:', reason?.message || reason);
  console.error('[FATAL] Stack:', reason?.stack || 'no stack');
  process.exit(1);
});
process.on('uncaughtException', (err) => {
  console.error('[FATAL] Uncaught Exception:', err.message);
  console.error('[FATAL] Stack:', err.stack);
  process.exit(1);
});

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const { launchBrowser, fetchAccessToken, getMailToken, findMagicLink, pollMagicLink } = require("./zo_register");

// ===== Pre-flight cleanup (only script-started browsers) =====
// NOTE: Does NOT kill ALL browsers — only orphaned ones from previous script runs
let scriptLaunchedPids = [];  // Track PIDs of browsers launched by this script

function preflightCleanup() {
  // ★ ONLY kill Edge processes that this script started (tracked via PIDs)
  // NEVER kill random Edge browsers that belong to the user
  if (scriptLaunchedPids.length > 0) {
    for (const pid of scriptLaunchedPids) {
      try { killProcessTree(pid); } catch(e) {}
    }
    scriptLaunchedPids = [];
  }

  // Clean up leftover temp dirs from previous runs
  const tmpBase = path.join("E:\\Openclaw\\tmp");
  if (fs.existsSync(tmpBase)) {
    const dirs = fs.readdirSync(tmpBase).filter(d => d.startsWith("zo_reg_"));
    for (const d of dirs) {
      try { fs.rmSync(path.join(tmpBase, d), { recursive: true, force: true }); } catch(e) {}
    }
    if (dirs.length > 0) console.log("Cleaned " + dirs.length + " orphaned temp dirs");
  }
  scriptLaunchedPids = [];
}

// ===== Aggressive temp dir cleanup (retries) =====
function cleanupTempDir(tempDir) {
  if (!tempDir) return;
  for (let i = 0; i < 3; i++) {
    try { fs.rmSync(tempDir, { recursive: true, force: true }); return; } catch(e) {}
    try { require("child_process").execSync(`rd /s /q "${tempDir}" 2>nul`, { stdio: "ignore" }); return; } catch(e) {}
    // wait for file locks to release
    require("child_process").execSync("ping -n 2 127.0.0.1 >nul", { stdio: "ignore" });
  }
}

// ===== Process tree killer (aggressive, recursive) =====
function killProcessTree(pid) {
  if (!pid) return;
  try {
    // Use WMI to recursively find and kill all descendant processes
    const psScript = `
$visited = @{${pid}=$true}
function Kill-Tree($p) {
  Get-CimInstance Win32_Process -Filter "ParentProcessId=$p" -ErrorAction SilentlyContinue | ForEach-Object {
    if (-not $visited[$_.ProcessId]) {
      $visited[$_.ProcessId] = $true
      Kill-Tree $_.ProcessId
      Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
    }
  }
  Stop-Process -Id $p -Force -ErrorAction SilentlyContinue
}
Kill-Tree ${pid}
Get-CimInstance Win32_Process -Filter "Name='msedge.exe' AND ParentProcessId=${pid}" -ErrorAction SilentlyContinue | ForEach-Object {
  Kill-Tree $_.ProcessId
}
`.replace(/\r?\n/g, ' ');
    execSync(`powershell -NoProfile -Command "${psScript}"`, { stdio: "ignore", timeout: 10000 });
  } catch(e) { /* best-effort */ }
}

// ===== Step timeout wrapper (60s per step) =====
async function withStepTimeout(stepName, promiseFn, log) {
  const TIMEOUT_MS = 60000;
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error("Timeout: " + stepName + " (" + TIMEOUT_MS/1000 + "s)")), TIMEOUT_MS);
  });
  try {
    return await Promise.race([promiseFn(), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

// ===== Browser count enforcement =====
const MAX_BROWSERS = 4;  // ★ User requirement: maximum 4 concurrent, NOT "start 4 every time"
let activeBrowsers = 0;
const browserQueue = [];
let browserQueueResolve = null;

async function acquireBrowserSlot() {
  if (activeBrowsers < MAX_BROWSERS) {
    activeBrowsers++;
    return;
  }
  // Wait for a slot
  return new Promise(resolve => {
    browserQueue.push(resolve);
  });
}

function releaseBrowserSlot() {
  activeBrowsers--;
  if (browserQueue.length > 0) {
    const next = browserQueue.shift();
    activeBrowsers++;
    next();
  }
}

preflightCleanup();

const ZO_FILE = path.join("C:\\Users\\XZXyuan\\Downloads", "zo_all.txt");
const REGISTERED_DIR = path.join(__dirname, "..", "registered");
const AT_DIR = path.join(REGISTERED_DIR, "Access Tokens");
const RESULTS_FILE = path.join(REGISTERED_DIR, "at_results.jsonl");
const BLOCKED_FILE = path.join(REGISTERED_DIR, "blocked_accounts.txt");
const COOKIE_AT_DIR = path.join(REGISTERED_DIR, "Cookie ATs");

// ===== Parse zo.txt =====
function parseAccounts(filePath) {
  const lines = fs.readFileSync(filePath, "utf8").split("\n").filter(l => l.trim());
  const seen = new Set();
  const accounts = [];
  for (const line of lines) {
    const parts = line.split("----");
    if (parts.length < 4) continue;
    const email = parts[0].trim();
    if (!email || seen.has(email)) continue;
    seen.add(email);
    // Fix: strip leading hyphen from clientId (data corruption)
    const rawClientId = parts[2].trim();
    const clientId = rawClientId.replace(/^-+/, '');
    accounts.push({
      email,
      password: parts[1].trim(),
      clientId,
      refreshToken: parts[3].trim(),
    });
  }
  return accounts;
}

// ===== Check which accounts already have AT =====
function getExistingATs() {
  if (!fs.existsSync(AT_DIR)) return new Set();
  const files = fs.readdirSync(AT_DIR);
  return new Set(files.map(f => f.replace(".txt", "")));
}

// ===== Dynamic AT check (per-attempt) =====
function hasAT(email) {
  return fs.existsSync(path.join(AT_DIR, email + ".txt"));
}

// ===== Cookie AT checks =====
function hasCookieAT(email) {
  return fs.existsSync(path.join(COOKIE_AT_DIR, email + ".txt"));
}

function saveCookieAT(email, handle, cookie, log) {
  if (!fs.existsSync(COOKIE_AT_DIR)) fs.mkdirSync(COOKIE_AT_DIR, { recursive: true });
  const cookieFile = path.join(COOKIE_AT_DIR, email + ".txt");
  const expires = cookie.expires > 0 ? new Date(cookie.expires * 1000).toISOString() : "unknown";
  fs.writeFileSync(cookieFile, [
    "email: " + email,
    "handle: " + handle,
    "zoAddress: " + handle + ".zo.computer",
    "cookieAT: " + cookie.value,
    "domain: " + (cookie.domain || ".zo.computer"),
    "expires: " + expires,
    "time: " + new Date().toISOString(),
  ].join("\n"), "utf-8");
  log("[COOKIE] ✅ Cookie AT saved: " + cookieFile);
}

async function getCookieATFromBrowser(browser, handle, log) {
  try {
    const allCookies = await browser.cookies();
    let atCookie = allCookies.find(c => c.name === 'access_token' && c.domain.includes('zo.computer'));
    if (atCookie) {
      log("[COOKIE] ✅ Found in browser cookies: " + atCookie.value.substring(0, 30) + "...");
      return atCookie;
    }
    // Try navigating to workspace to trigger cookie set
    if (handle) {
      const wsUrl = "https://" + handle + ".zo.computer/";
      log("[COOKIE] Not in cookies, navigating to workspace: " + wsUrl);
      const pages = await browser.pages();
      const cookiePage = pages[pages.length - 1] || pages[0];
      await cookiePage.goto(wsUrl, { waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {});
      await new Promise(r => setTimeout(r, 3000));
      const cookies2 = await browser.cookies();
      atCookie = cookies2.find(c => c.name === 'access_token' && c.domain.includes('zo.computer'));
      if (atCookie) {
        log("[COOKIE] ✅ Found after workspace nav: " + atCookie.value.substring(0, 30) + "...");
        return atCookie;
      }
      log("[COOKIE] ❌ Still no access_token cookie after retry");
    }
    return null;
  } catch (e) {
    log("[COOKIE] ❌ Error: " + e.message.substring(0, 60));
    return null;
  }
}

// ===== Load blocked accounts =====
function loadBlockedAccounts() {
  if (!fs.existsSync(BLOCKED_FILE)) return new Set();
  const lines = fs.readFileSync(BLOCKED_FILE, "utf8").split("\n").filter(l => l.trim());
  return new Set(lines.map(l => l.trim()));
}

// ===== Error classification =====
function classifyError(errorMsg) {
  if (/AADSTS70000|service abuse|account.*locked|account.*disabled/i.test(errorMsg)) return "blocked";
  if (/Cannot determine ZO handle/i.test(errorMsg)) return "permanent";
  if (/Cannot find email button/i.test(errorMsg)) return "permanent";
  if (/Email not sent/i.test(errorMsg)) return "permanent";
  if (/ERR_CONNECTION_CLOSED|ERR_CONNECTION_RESET|net::ERR/i.test(errorMsg)) return "transient";
  if (/timeout|Navigation timeout/i.test(errorMsg)) return "transient";
  if (/No magic link found/i.test(errorMsg)) return "transient";
  if (/Failed to get both AT and Cookie AT/i.test(errorMsg)) return "transient";
  if (/Failed to get access token/i.test(errorMsg)) return "transient";
  if (/ZO space did not boot/i.test(errorMsg)) return "transient";
  return "transient";
}

// ===== Complete registration (set handle when on /signup page) =====
async function completeRegistration(page, email, log) {
  log("[REG] Completing registration (setting handle)...");
  // Generate unique handle with random suffix to avoid conflicts
  const baseHandle = email.split("@")[0].substring(0, 5).toLowerCase().replace(/[^a-z0-9]/g, "");
  const randSuffix = Math.random().toString(36).substring(2, 5);
  const handle = baseHandle + randSuffix;
  log("[REG] Handle: " + handle);
  
  // ★ First check: maybe the page already redirected to workspace (account was already registered)
  await new Promise(r => setTimeout(r, 3000));  // Brief wait for any pending redirects
  let currentUrl = page.url();
  log("[REG] Current URL after redirect: " + currentUrl);
  
  // Check if already on workspace (subdomain.zo.computer)
  const urlMatch = currentUrl.match(/https?:\/\/([^.]+)\.zo\.computer/);
  if (urlMatch && urlMatch[1] !== 'www' && urlMatch[1] !== 'app') {
    const actualHandle = urlMatch[1];
    log("[REG] ✅ Already on workspace: " + actualHandle + ".zo.computer (account already registered)");
    return actualHandle;
  }
  
  // Still on /signup, need to complete registration
  log("[REG] Still on /signup, polling for form to render...");
  let handleInput = null;
  for (let i = 0; i < 60; i++) {  // 60s max (1s each)
    await new Promise(r => setTimeout(r, 1000));
    
    // Check URL again (might have redirected during polling)
    currentUrl = page.url();
    const urlMatch2 = currentUrl.match(/https?:\/\/([^.]+)\.zo\.computer/);
    if (urlMatch2 && urlMatch2[1] !== 'www' && urlMatch2[1] !== 'app') {
      log("[REG] ✅ Redirected to workspace during wait: " + urlMatch2[1] + ".zo.computer");
      return urlMatch2[1];
    }
    
    try {
      handleInput = await page.$("input[placeholder='you']");
      if (!handleInput) handleInput = await page.$("input[name='handle']");
      if (!handleInput) handleInput = await page.$("input[type=text]:not([readonly])");
      if (!handleInput) {
        const found = await page.evaluate(() => {
          const inputs = Array.from(document.querySelectorAll('input'));
          for (const inp of inputs) {
            if (inp.offsetWidth > 0 && inp.offsetHeight > 0 && (!inp.type || inp.type === 'text' || inp.type === 'username')) {
              return true;
            }
          }
          return false;
        });
        if (found) handleInput = await page.$("input:visible");
      }
    } catch(e) { /* context may be destroyed, retry */ }
    
    if (handleInput) {
      log("[REG] ✅ Handle input found after " + i + "s");
      break;
    }
    
    if (i % 15 === 0 && i > 0) {
      const bodySnippet = await page.evaluate(() => document.body.innerText.substring(0, 150)).catch(() => "");
      log("[REG] Still waiting for form... (" + i + "s) URL: " + currentUrl.substring(0, 60) + " | " + bodySnippet.substring(0, 80).replace(/\n/g, ' '));
    }
  }
  if (!handleInput) { log("[REG] ❌ Handle input not found after 5 minutes"); return null; }
  
  // Fill handle with realistic typing
  try {
    await handleInput.click({ clickCount: 3 });
    await new Promise(r => setTimeout(r, 200));
    await page.keyboard.down('Control'); await page.keyboard.press('a'); await page.keyboard.up('Control');
    await page.keyboard.press('Backspace');
    for (const ch of handle) { await page.keyboard.type(ch, { delay: 80 + Math.random() * 60 }); }
    log("[REG] Handle filled: " + handle);
  } catch(e) {
    try { await handleInput.click({ clickCount: 3 }); await handleInput.type(handle, { delay: 50 }); } catch(e2) {}
    log("[REG] Handle filled (fallback)");
  }
  await new Promise(r => setTimeout(r, 500));
  
  // Click Continue via direct DOM click (more reliable than mouse coordinates)
  // ★ Take screenshot before clicking for debugging
  try {
    await page.screenshot({ path: 'E:\\API\u83b7\u53d6\u5de5\u5177\\ZO\u6ce8\u518c\\plugin\\debug_before_continue.png', fullPage: true });
    log("[REG] Screenshot saved: debug_before_continue.png");
  } catch(e) {}
  log("[REG] Clicking Continue...");
  let clicked = false;
  for (let a = 0; a < 8 && !clicked; a++) {
    // Try multiple click strategies via page.evaluate
    const clickResult = await page.evaluate(() => {
      for (const btn of document.querySelectorAll('button, [role="button"], input[type="submit"]')) {
        const txt = (btn.textContent || btn.value || '').trim();
        if (/continue|submit|sign.?up|create|get.?started|set.?up|next/i.test(txt) && btn.offsetWidth > 0 && btn.offsetHeight > 0) {
          // Strategy 1: direct click()
          btn.click();
          // Strategy 2: dispatch MouseEvent for React
          btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
          // Strategy 3: also try form.submit if inside a form
          const form = btn.closest('form');
          if (form) { try { form.requestSubmit(); } catch(e) {} }
          return { txt };
        }
      }
      return null;
    }).catch(() => null);
    if (clickResult) {
      log("[REG] Clicked button: '" + clickResult.txt + "' (attempt " + (a+1) + ", DOM click+dispatch)");
      clicked = true;
      // Wait briefly to see if page reacts
      await new Promise(r => setTimeout(r, 3000));
      // Check if we left /signup or if Turnstile/error appeared
      const afterUrl = page.url();
      // ★ Screenshot after click for debugging
      try {
        await page.screenshot({ path: 'E:\\API\u83b7\u53d6\u5de5\u5177\\ZO\u6ce8\u518c\\plugin\\debug_after_continue.png', fullPage: true });
      } catch(e) {}
      if (afterUrl !== currentUrl || !/signup/i.test(afterUrl)) {
        log("[REG] Page navigated after click: " + afterUrl.substring(0, 80));
        break;
      }
      // Check for Turnstile or error
      const afterTxt = await page.evaluate(() => document.body.innerText.substring(0, 500)).catch(() => "");
      if (/turnstile|challenge|verif/i.test(afterTxt)) {
        log("[REG] ⚠️ Turnstile/challenge appeared after click, waiting...");
        // Wait for Turnstile to auto-solve
        for (let t = 0; t < 30; t++) {
          await new Promise(r => setTimeout(r, 2000));
          const u = page.url();
          if (!/signup|verify|email-login/i.test(u) && /zo\.computer/.test(u)) {
            log("[REG] ✅ Redirected after Turnstile: " + u.substring(0, 80));
            return handle;
          }
          const ttxt = await page.evaluate(() => document.body.innerText.substring(0, 300)).catch(() => "");
          if (!/turnstile|challenge/i.test(ttxt)) break;
        }
      }
      if (/error|taken|invalid|already.?exists/i.test(afterTxt)) {
        log("[REG] ⚠️ Validation error: " + afterTxt.substring(0, 150));
        // If handle taken, try generating a new one
        if (/taken|already|exists/i.test(afterTxt) && a < 5) {
          const newHandle = baseHandle + Math.random().toString(36).substring(2, 6);
          log("[REG] Handle might be taken, trying: " + newHandle);
          await page.evaluate((h) => {
            const inp = document.querySelector('input[placeholder*="you"], input[name="handle"], input[type="text"]:not([readonly])');
            if (inp) { 
              inp.focus(); inp.value = ''; 
              inp.dispatchEvent(new Event('input', { bubbles: true }));
              inp.value = h; 
              inp.dispatchEvent(new Event('input', { bubbles: true }));
              inp.dispatchEvent(new Event('change', { bubbles: true }));
            }
          }, newHandle).catch(() => {});
          await new Promise(r => setTimeout(r, 1000));
          clicked = false; // retry click with new handle
        }
      }
    } else {
      await new Promise(r => setTimeout(r, 1000));
    }
  }
  // Fallback: try mouse click at button coordinates
  if (!clicked || /signup/i.test(page.url())) {
    log("[REG] Trying mouse click fallback...");
    const btnPos = await page.evaluate(() => {
      for (const btn of document.querySelectorAll('button, [role="button"], input[type="submit"]')) {
        const txt = (btn.textContent || btn.value || '').trim();
        if (/continue|submit|sign.?up|create|next/i.test(txt) && btn.offsetWidth > 0) {
          const r = btn.getBoundingClientRect();
          return { x: r.left + r.width/2, y: r.top + r.height/2 };
        }
      }
      return null;
    }).catch(() => null);
    if (btnPos) {
      await page.mouse.click(btnPos.x, btnPos.y, { delay: 100 });
      log("[REG] Mouse click at (" + Math.round(btnPos.x) + ", " + Math.round(btnPos.y) + ")");
      await new Promise(r => setTimeout(r, 3000));
    }
  }
  // Fallback: try Enter key
  if (/signup/i.test(page.url())) {
    log("[REG] Trying Enter key as fallback...");
    try { await page.keyboard.press('Enter'); } catch(e) {}
    await new Promise(r => setTimeout(r, 3000));
  }
  
  // Wait for redirect away from /signup (poll URL, not hard waits)
  for (let i = 0; i < 20; i++) {
    await new Promise(r => setTimeout(r, 2000));
    try {
      const url = page.url();
      if (/zo\.computer/.test(url) && !/signup|verify|email-login/i.test(url)) {
        try { const hn = new URL(url).hostname;
          if (hn.endsWith('.zo.computer') && hn !== 'www.zo.computer') {
            log("[REG] ✅ Redirected to workspace: " + url.substring(0, 80)); return handle;
          }
        } catch(e) {}
        log("[REG] ✅ Redirected: " + url.substring(0, 80)); return handle;
      }
      const txt = await page.evaluate(() => document.body.innerText.substring(0, 300)).catch(() => "");
      if (/home|files|automations|skills|browser|hosting|zospace/i.test(txt) && !/sign.?up|email.login|verify/i.test(txt)) {
        log("[REG] ✅ Workspace detected!"); return handle;
      }
    } catch(e) {}
  }
  
  // Try direct nav to handle subdomain
  log("[REG] Trying direct nav to " + handle + ".zo.computer...");
  for (let r = 0; r < 3; r++) {
    try {
      await page.goto("https://" + handle + ".zo.computer/", { waitUntil: "domcontentloaded", timeout: 30000 });
      await new Promise(r => setTimeout(r, 5000));
      const u = page.url();
      if (u.includes(handle + ".zo.computer")) { log("[REG] ✅ Direct nav OK"); return handle; }
      try { const hn = new URL(u).hostname;
        if (hn.endsWith('.zo.computer') && hn !== 'www.zo.computer') { log("[REG] ✅ On workspace"); return handle; }
      } catch(e) {}
    } catch(e) { log("[REG] Nav " + (r+1) + " failed: " + e.message.substring(0, 40)); }
    await new Promise(r => setTimeout(r, 3000));
  }
  
  log("[REG] ⚠️ Handle set but redirect unconfirmed: " + handle);
  return handle;
}

// ===== Login + Get AT for one account =====
async function loginAndGetAT(account, config, log) {
  const { email, clientId, refreshToken } = account;
  let browser, tempDir, browserPid = null;
  
  try {
    // ★ Acquire browser slot (blocks if MAX_BROWSERS reached)
    await acquireBrowserSlot();
    log("[BROWSER] Slot acquired (active: " + activeBrowsers + "/" + MAX_BROWSERS + ")");
    
    // Launch browser
    const launched = await launchBrowser(config, log);
    browser = launched.browser;
    tempDir = launched.tempDir;
    // ★ Capture PID immediately after launch for reliable cleanup
    try { 
      browserPid = browser.process()?.pid; 
      if (browserPid) {
        scriptLaunchedPids.push(browserPid);
        log("[BROWSER] PID captured: " + browserPid + " (tracked: " + scriptLaunchedPids.length + ")"); 
      }
    } catch(e) { log("[BROWSER] PID capture failed: " + e.message); }
    const page = launched.page;
    page.setDefaultTimeout(60000);
    await page.setViewport({ width: 1440, height: 900 });

    // === Step 1: Open signup/login page ===
    log("[1/5] Opening ZO login page...");
    await page.goto("https://www.zo.computer/signup", { waitUntil: "domcontentloaded", timeout: 45000 });
    // Poll for page to be interactive instead of hard 2s wait
    for (let i = 0; i < 15; i++) {
      const ready = await page.evaluate(() => document.readyState).catch(() => "loading");
      const hasBtn = await page.evaluate(() => {
        for (const b of document.querySelectorAll('button')) {
          if (/Email me a sign-up link/i.test((b.textContent || '').trim()) || /sign.?up|log.?in/i.test((b.textContent || '').trim())) return true;
        }
        return false;
      }).catch(() => false);
      if (ready === "complete" && hasBtn) break;
      await new Promise(r => setTimeout(r, 1000));
    }

    // === Step 2: Click "Email me a sign-up link" === robust retry
    log("[2/5] Clicking email button...");
    let clicked = false;
    for (let attempt = 0; attempt < 10 && !clicked; attempt++) {
      if (attempt > 0) await new Promise(r => setTimeout(r, 1500));
      
      // Diagnostic: log page URL and title
      const diagUrl = page.url();
      const diagTitle = await page.title().catch(() => "error");
      
      const ready = await page.evaluate(() => document.readyState).catch((e) => {
        log("  [DIAG] evaluate error: " + e.message.substring(0, 80));
        return "unknown";
      });
      
      if (ready !== "complete" && ready !== "interactive") {
        log("  Page not ready (" + ready + "), URL: " + diagUrl.substring(0, 60) + ", title: " + diagTitle);
        continue;
      }
      
      const btns = await page.$$("button");
      for (const btn of btns) {
        const txt = await btn.evaluate(e => e.textContent).catch(() => "");
        if (/Email me a sign-up link/i.test(txt)) {
          await btn.click();
          clicked = true;
          break;
        }
      }
      if (!clicked && attempt >= 2) {
        log("  Button not found yet (attempt " + (attempt+1) + "/10), found " + btns.length + " buttons");
      }
    }
    if (!clicked) throw new Error("Cannot find email button after 10 attempts");
    await new Promise(r => setTimeout(r, 2000));

    // === Step 3: Fill email + submit ===
    log("[3/5] Filling email: " + email);
    let emailInput = null;
    for (let i = 0; i < 10; i++) {
      emailInput = await page.$("input[type=email], input#email, input[name=email]");
      if (!emailInput) {
        const allInputs = await page.$$("input");
        for (const inp of allInputs) {
          const ph = await inp.evaluate(e => (e.placeholder || "") + " " + (e.type || "")).catch(() => "");
          if (/email/i.test(ph)) { emailInput = inp; break; }
        }
      }
      if (emailInput) break;
      await new Promise(r => setTimeout(r, 2000));
    }
    if (!emailInput) throw new Error("Email input not found");

    await emailInput.click({ clickCount: 3 });
    await emailInput.type(email, { delay: 20 });
    await new Promise(r => setTimeout(r, 300));

    // Click Continue
    const cBtns = await page.$$("button");
    for (const btn of cBtns) {
      const txt = await btn.evaluate(e => e.textContent.trim()).catch(() => "");
      if (/^Continue$/i.test(txt)) { await btn.click(); break; }
    }

    // Wait for confirmation (poll until page shows success message)
    let emailSent = false;
    for (let i = 0; i < 15; i++) {
      await new Promise(r => setTimeout(r, 1000));
      const txt = await page.evaluate(() => document.body.innerText.substring(0, 500)).catch(() => "");
      if (/check your email|login link|magic link/i.test(txt)) { emailSent = true; break; }
      // Log page content periodically to diagnose what's shown
      if (i % 5 === 4) {
        log("  [DIAG] Page text after Continue: " + txt.substring(0, 120).replace(/\n/g, ' '));
      }
    }
    if (!emailSent) {
      const finalTxt = await page.evaluate(() => document.body.innerText).catch(() => "");
      log("  [DIAG] Final page text: " + finalTxt.substring(0, 300).replace(/\n/g, ' '));
      throw new Error("Email not sent");
    }
    log("  Email sent!");

    // === Step 4: Get magic link via Graph API ===
    log("[4/5] Polling for magic link...");
    const sendTime = new Date();
    const result = await pollMagicLink(email, clientId, refreshToken, sendTime, log, config);
    if (!result || !result.link) throw new Error("No magic link found");
    log("  Magic link found!");

    // === Step 5: Open magic link → login → boot → settings → AT ===
    log("[5/5] Opening magic link...");
    // ★ DO NOT clear cookies — they carry the session needed for redirect
    const preNavUrl = page.url();
    let navOk = false;
    for (let navRetry = 0; navRetry < 3; navRetry++) {
      try {
        await page.goto(result.link, { waitUntil: "domcontentloaded", timeout: 60000 });
        navOk = true;
        break;
      } catch(navErr) {
        if (/timeout/i.test(navErr.message)) {
          log("  Navigation timeout, continuing...");
          navOk = true;
          break;
        } else if (/net::ERR_/i.test(navErr.message)) {
          throw new Error("Network error opening link: " + navErr.message);
        } else if (/detached|destroyed|disposed/i.test(navErr.message)) {
          log("  Nav error (detached frame), retry " + (navRetry+1) + "/3...");
          await new Promise(r => setTimeout(r, 3000));
          try { const pages = await browser.pages(); if (pages.length > 0) page = pages[pages.length - 1]; } catch(e) {}
        } else {
          log("  Nav error: " + navErr.message.substring(0, 60) + ", continuing...");
          navOk = true;
          break;
        }
      }
    }
    // Verify page actually navigated to the magic link
    await new Promise(r => setTimeout(r, 2000));
    if (!page.url().includes('email-login/verify') && !page.url().includes('/signup') && page.url() === preNavUrl) {
      log("  ⚠️ Page didn't navigate, retrying...");
      try { await page.goto(result.link, { waitUntil: "domcontentloaded", timeout: 60000 }); } catch(e) { log("  Retry failed: " + e.message.substring(0, 60)); }
    }
    // Give the page a moment to start Turnstile, then poll
    await new Promise(r => setTimeout(r, 1000));

    // Step 5b: Wait for Turnstile — extension auto-bypass + active token retrieval
    // ★ Extension (world:MAIN, all_frames:true) patches screenX/screenY etc.
    // ★ Also actively call turnstile.reset()/getResponse() + click Continue (same as server.cjs)
    log("  Waiting for Turnstile (extension + active retrieval)...");
    let redirectDone = false;
    let clickedContinueOnce = false;
    const startVerifyUrl = page.url();
    for (let i = 0; i < 20; i++) {  // 60s max (3s per iteration)
      const txt = await page.evaluate(() => document.body.innerText.substring(0, 300)).catch(() => "");
      const url = page.url();

      // ★ Active Turnstile token retrieval (from server.cjs)
      if (i >= 2 && !clickedContinueOnce) {
        const turnstileResult = await page.evaluate(() => {
          // Method 1: turnstile.getResponse()
          try {
            if (typeof turnstile !== 'undefined') {
              const res = turnstile.getResponse();
              if (res) {
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
          // Method 2: check hidden input
          try {
            const input = document.querySelector('input[name="cf-turnstile-response"]');
            if (input && input.value) return { status: 'ready', tokenLen: input.value.length };
          } catch (e) {}
          // Method 3: check iframe
          const iframes = document.querySelectorAll('iframe[src*="turnstile"], iframe[src*="challenges"]');
          if (iframes.length === 0) return { status: 'no_iframe' };
          return { status: 'pending' };
        }).catch(() => ({ status: 'unknown' }));

        if (turnstileResult.tokenLen) {
          log("  [Turnstile] Token obtained! len=" + turnstileResult.tokenLen);
        }
        if (i % 5 === 0) log("  [" + (i*3) + "s] Turnstile: " + turnstileResult.status + " | " + txt.substring(0, 50).replace(/\n/g, ' '));

        // ★ Active reset + getResponse (from server.cjs)
        if (turnstileResult.status === 'pending' && i > 0 && i % 3 === 0) {
          const resetResult = await page.evaluate(() => {
            try {
              if (typeof turnstile !== 'undefined') {
                turnstile.reset();
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
            log("  [Turnstile] Token obtained via reset+getResponse!");
          }
        }

        // ★ Click "Continue in browser" button (from server.cjs)
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
            log("  Clicked 'Continue in browser' (turnstile=" + turnstileResult.status + ")");
            clickedContinueOnce = true;
            await new Promise(r => setTimeout(r, 5000));
            const afterTxt = await page.evaluate(() => document.body.innerText.substring(0, 300)).catch(() => "");
            const afterUrl = page.url();
            if (/choose your handle/i.test(afterTxt)) {
              log("  Reached handle page after continue!");
              redirectDone = true;
              break;
            }
            if (/redirecting/i.test(afterTxt)) {
              log("  Page redirecting after continue (URL: " + afterUrl.substring(0, 70) + ")...");
              // ★ Don't interrupt - let the page redirect naturally. It takes 10-20s.
            }
            continue;
          }
        }
      }

      // ★ Check if we landed on main UI (already registered)
      try {
        const hn = new URL(url).hostname;
        if (hn.endsWith('.zo.computer') && hn !== 'www.zo.computer' && !url.includes('/signup') && !url.includes('/email-login')) {
          // ★ But verify the page actually shows main UI, not a registration form
          const needsReg = await page.evaluate(() => {
            const txt = document.body.innerText || '';
            const hasHandleInput = !!document.querySelector('input[placeholder*="you"], input[name="handle"], input[type="text"]:not([readonly])');
            const hasRegText = /choose.*handle|create.*handle|set.*username|complete.*profile|pick.*handle/i.test(txt);
            return hasHandleInput || hasRegText;
          }).catch(() => false);
          
          if (needsReg) {
            log("  ⚠️ Subdomain URL but needs registration (handle input detected): " + url);
            // Don't break - let it fall through to registration handling below
          } else {
            log("  ✅ Already registered! Directly at main UI: " + url);
            redirectDone = true;
            break;
          }
        }
      } catch(e) {}

      // Check if we reached a non-verify page (but URL must have changed from pre-nav)
      if (/zo\.computer/.test(url) && !/verify|email-login/i.test(url) && url !== preNavUrl) {
        log("  ✅ Redirect done (" + (i*3) + "s): " + url.substring(0, 80));
        redirectDone = true;
        break;
      }

      // ★ Check if we're on /signup with registration form (redirect completed back to signup)
      if (/\/signup/i.test(url) && !/email-login|verify/i.test(url)) {
        const hasRegForm = /choose.*handle|set up.*computer|handle.*zo\.computer/i.test(txt);
        const hasHandleInput = await page.evaluate(() => {
          return !!document.querySelector('input[placeholder*="you"], input[name="handle"]');
        }).catch(() => false);
        if (hasRegForm || hasHandleInput) {
          log("  ✅ Redirected to signup page with registration form (" + (i*3) + "s)");
          redirectDone = true;
          break;
        }
      }

      // Check for expired/invalid link
      if (/invalid|expired/i.test(txt) && !/redirecting|verif|turnstile|challenge/i.test(txt)) {
        throw new Error("Invalid or expired login link");
      }

      // Monitor redirect progress
      if (/redirecting/i.test(txt)) {
        if (i % 5 === 0) {
          log("  [" + (i*3) + "s] Page redirecting... URL: " + page.url());
          await page.screenshot({ path: "debug_redirecting_" + i + ".png" }).catch(() => {});
        }

        // ★ Stuck redirect recovery
        if (i >= 10 && url.includes('email-login/verify')) {
          const recoveryCookie = await page.cookies();
          const recoveryAT = recoveryCookie.find(c => c.name === 'access_token' && c.domain.includes('zo.computer'));
          
          // Fast-fail: 30s with no cookie = token was never verified, abort now
          if (i >= 10 && !recoveryAT) {
            log("  ❌ Fast-fail after 30s: no access_token cookie set (token never verified).");
            throw new Error("Login token not verified (no access_token cookie after 30s)");
          }
          
          if (recoveryAT) {
            if (i === 10) log("  ✅ access_token cookie present! Trying direct workspace navigation...");
            const guessedHandle = email.replace(/@.*/, '').replace(/[^a-z0-9]/g, '').substring(0, 15);
            const wsUrl = 'https://' + guessedHandle + '.zo.computer/_boot';
            try {
              await page.goto(wsUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
              await new Promise(r => setTimeout(r, 2000));
              const afterNavUrl = page.url();
              if (afterNavUrl.includes(guessedHandle + '.zo.computer')) {
                log("  ✅ Reached workspace via direct navigation!");
                redirectDone = true;
                break;
              }
            } catch(navErr) {
              if (i === 10) log("  Direct nav error: " + navErr.message.substring(0, 50));
            }
          } else if (i === 10) {
            log("  ⚠️ No cookie after 30s. Fast-failing now.");
          }
        }
      }

      await new Promise(r => setTimeout(r, 3000));
    }

    if (!redirectDone) {
      throw new Error("Login redirect did not complete (60s timeout)");
    }

    // ★ Check if page is on /signup (needs registration completion)
    const currentUrl = page.url();
    let handle = "";
    
    if (/\/signup/i.test(currentUrl) && !/email-login/i.test(currentUrl)) {
      log("  ⚠️ Account needs registration completion (on /signup)");
      const completedHandle = await completeRegistration(page, email, log);
      if (completedHandle) {
        handle = completedHandle;
        log("  ✅ Registration completed, handle: " + handle);
      } else {
        throw new Error("Cannot determine ZO handle for " + email);
      }
    } else {

    // ★ Even on subdomain URL, check if registration is still needed
    const needsRegCheck = await page.evaluate(() => {
      const txt = document.body.innerText || '';
      const hasHandleInput = !!document.querySelector('input[placeholder*="you"], input[name="handle"]');
      const hasRegText = /choose.*handle|create.*handle|set.*username|complete.*profile|pick.*handle|you.*handle/i.test(txt);
      // Also check for visible text input that looks like a handle field
      const visibleInputs = document.querySelectorAll('input[type="text"]:not([readonly]), input[type="username"]');
      let hasVisibleHandleInput = false;
      for (const inp of visibleInputs) {
        if (inp.offsetWidth > 100 && inp.offsetHeight > 0) { hasVisibleHandleInput = true; break; }
      }
      return hasHandleInput || hasRegText || hasVisibleHandleInput;
    }).catch(() => false);

    if (needsRegCheck) {
      log("  ⚠️ Subdomain URL but registration form detected — completing registration...");
      const completedHandle = await completeRegistration(page, email, log);
      if (completedHandle) {
        handle = completedHandle;
        log("  ✅ Registration completed, handle: " + handle);
      } else {
        throw new Error("Cannot determine ZO handle for " + email);
      }
    } else {

    // Extract handle — multiple strategies with retries

    // Strategy 1: Wait for page to render, then find "Go to your Zo" link
    for (let retry = 0; retry < 5 && !handle; retry++) {
      await new Promise(r => setTimeout(r, 2000));
      const goLink = await page.evaluate(() => {
        for (const a of document.querySelectorAll('a[href]')) {
          const href = a.getAttribute('href') || '';
          const txt = (a.textContent || '').trim();
          if (/Go to your Zo/i.test(txt) || (href.includes('.zo.computer') && !href.includes('www.zo.computer') && !href.includes('app.zo.computer'))) {
            return href;
          }
        }
        return null;
      }).catch(() => null);

      if (goLink) {
        const handleMatch = goLink.match(/https?:\/\/([^.]+)\.zo\.computer/);
        if (handleMatch && handleMatch[1] !== 'www' && handleMatch[1] !== 'app') {
          handle = handleMatch[1];
          log("  Handle from 'Go to your Zo' link: " + handle);
        }
      }
    }

    // Strategy 2: Check if URL has navigated to handle subdomain
    if (!handle) {
      const urlMatch = page.url().match(/https?:\/\/([^.]+)\.zo\.computer/);
      if (urlMatch && urlMatch[1] !== 'www' && urlMatch[1] !== 'app') {
        handle = urlMatch[1];
        log("  Handle from URL: " + handle);
      }
    }

    // Strategy 3: Look up from results.jsonl
    if (!handle) {
      const resultsFile = path.join(REGISTERED_DIR, "results.jsonl");
      if (fs.existsSync(resultsFile)) {
        const lines = fs.readFileSync(resultsFile, "utf8").split("\n").filter(l => l.trim());
        for (const line of lines.reverse()) {
          try {
            const obj = JSON.parse(line);
            if (obj.email === email && obj.handle && obj.status !== "fail") {
              handle = obj.handle;
              log("  Handle from results.jsonl: " + handle);
              break;
            }
          } catch(e) {}
        }
      }
    }

    if (!handle) {
      // Last resort: try clicking "Go to your Zo" via CDP and wait for navigation
      log("  Trying CDP click on 'Go to your Zo'...");
      const clicked = await page.evaluate(() => {
        for (const a of document.querySelectorAll('a[href]')) {
          if (/Go to your Zo/i.test((a.textContent || '').trim())) {
            return a.href;
          }
        }
        return null;
      }).catch(() => null);
      
      if (clicked) {
        const handleMatch = clicked.match(/https?:\/\/([^.]+)\.zo\.computer/);
        if (handleMatch && handleMatch[1] !== 'www') {
          handle = handleMatch[1];
          log("  Handle from late scan: " + handle);
        }
      }
    }
    } // end of inner else (no registration needed)
    } // end of else block for non-/signup pages

    // ★ Strategy 5: If still no handle, try to find it from the page content
    if (!handle) {
      log("  Trying to extract handle from page content...");
      const pageContent = await page.evaluate(() => document.body.innerText).catch(() => "");
      const handlePatterns = [
        /https?:\/\/([a-z0-9]+)\.zo\.computer/gi,
        /([a-z0-9]+)\.zo\.computer/gi,
      ];
      for (const pat of handlePatterns) {
        let match;
        while ((match = pat.exec(pageContent)) !== null) {
          if (match[1] !== 'www' && match[1] !== 'app' && match[1].length >= 4) {
            handle = match[1];
            log("  Handle from page content: " + handle);
            break;
          }
        }
        if (handle) break;
      }
    }
    
    // ★ Strategy 6: Try navigating to email-based handle
    if (!handle) {
      const emailHandle = email.split("@")[0].substring(0, 8).toLowerCase().replace(/[^a-z0-9]/g, "");
      log("  Trying email-based handle: " + emailHandle);
      try {
        await page.goto("https://" + emailHandle + ".zo.computer/", { waitUntil: "domcontentloaded", timeout: 15000 });
        await new Promise(r => setTimeout(r, 3000));
        const testUrl = page.url();
        if (testUrl.includes(emailHandle + ".zo.computer")) {
          handle = emailHandle;
          log("  ✅ Email-based handle works: " + handle);
        }
      } catch(e) {
        log("  Email-based handle test failed: " + e.message.substring(0, 50));
      }
    }

    if (!handle) {
      throw new Error("Cannot determine ZO handle for " + email);
    }

    // ★ Check if we're still stuck on /signup (registration didn't complete)
    const preBootUrl = page.url();
    if (/\/signup/i.test(preBootUrl)) {
      log("  ⚠️ Still on /signup after registration attempt — retrying Continue click...");
      // Try clicking Continue again
      const retryClicked = await page.evaluate(() => {
        for (const btn of document.querySelectorAll('button, [role="button"], input[type="submit"]')) {
          const txt = (btn.textContent || btn.value || '').trim();
          if (/continue|submit|sign.?up|create|next/i.test(txt) && btn.offsetWidth > 0) {
            btn.click();
            return txt;
          }
        }
        return null;
      }).catch(() => null);
      if (retryClicked) {
        log("  [REG] Retry click: '" + retryClicked + "'");
        await new Promise(r => setTimeout(r, 5000));
      } else {
        // Try Enter key
        await page.keyboard.press('Enter').catch(() => {});
        await new Promise(r => setTimeout(r, 5000));
      }
      // Check again
      const afterRetryUrl = page.url();
      if (/\/signup/i.test(afterRetryUrl)) {
        log("  ❌ Registration failed — still on /signup. Aborting this account.");
        throw new Error("Registration incomplete: stuck on /signup for " + email);
      }
      log("  ✅ Registration retry succeeded: " + afterRetryUrl.substring(0, 80));
    }

    // === Boot dormant ZO space ===
    log("  Navigating to " + handle + ".zo.computer/_boot ...");
    try {
      await page.goto("https://" + handle + ".zo.computer/_boot", { waitUntil: "domcontentloaded", timeout: 30000 });
    } catch(bootErr) {
      if (/detached|destroyed|disposed|target closed/i.test(bootErr.message)) {
        log("  ⚠️ Boot nav failed (detached frame), retrying with fresh page...");
        try {
          const pages = await browser.pages();
          if (pages.length > 0) page = pages[pages.length - 1];
          await page.goto("https://" + handle + ".zo.computer/_boot", { waitUntil: "domcontentloaded", timeout: 30000 });
        } catch(retryErr) {
          log("  ⚠️ Retry also failed: " + retryErr.message.substring(0, 60));
        }
      } else {
        throw bootErr;
      }
    }
    await new Promise(r => setTimeout(r, 3000));

    // Check if we're on the boot page (dormant) or already active
    let bootUrl = page.url();
    log("  Boot page URL: " + bootUrl.substring(0, 80));

    // If on _boot page, look for the restore/wake button and click it
    if (/_boot/i.test(bootUrl)) {
      log("  ZO space is dormant, looking for wake button...");
      let wakeClicked = false;
      for (let attempt = 0; attempt < 5 && !wakeClicked; attempt++) {
        // Try various button texts that might wake the space
        const btnClicked = await page.evaluate(() => {
          const btns = document.querySelectorAll('button, a[role=button], [role=button], input[type=submit]');
          for (const btn of btns) {
            const txt = (btn.textContent || btn.value || '').trim();
            // Match 'Start computer' but NOT 'Restart computer'
            const isStartBtn = /^start computer$/i.test(txt) || /^start$/i.test(txt);
            const isOtherWake = /save|restore|wake|boot|launch|activate|bring back/i.test(txt) && !/restart/i.test(txt);
            if (isStartBtn || isOtherWake) {
              btn.click();
              return txt;
            }
          }
          return null;
        }).catch(() => null);

        if (btnClicked) {
          log("  Clicked wake button: '" + btnClicked + "'");
          wakeClicked = true;
        } else {
          // Try CDP real click on any visible button
          const allBtns = await page.evaluate(() => {
            const items = [];
            for (const btn of document.querySelectorAll('button, a[role=button]')) {
              const rect = btn.getBoundingClientRect();
              const txt = (btn.textContent || '').trim();
              if (rect.width > 0 && rect.height > 0 && txt.length > 0 && txt.length < 50) {
                items.push({ txt, x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
              }
            }
            return items;
          }).catch(() => []);
          log("  Visible buttons: " + allBtns.map(b => b.txt).join(', '));
          
          // Click the first meaningful button (NOT Restart)
          for (const b of allBtns) {
            const isStartBtn = /^start computer$/i.test(b.txt) || /^start$/i.test(b.txt);
            const isOtherWake = /save|restore|wake|boot|launch|activate|continue/i.test(b.txt) && !/restart/i.test(b.txt);
            if (isStartBtn || isOtherWake) {
              log("  CDP clicking: '" + b.txt + "'");
              await page.mouse.click(b.x, b.y);
              wakeClicked = true;
              break;
            }
          }
        }

        if (!wakeClicked) await new Promise(r => setTimeout(r, 3000));
      }

      // Wait for ZO space to boot up — 智能轮询 (2s间隔, 最长5分钟)
      if (wakeClicked) {
        log("  Waiting for ZO space to boot (smart poll, 2s interval)...");
        let bootDone = false;
        for (let i = 0; i < 150; i++) {
          await new Promise(r => setTimeout(r, 2000));
          const curUrl = page.url();
          
          // ★ Primary: URL changed from _boot → boot is done
          if (!/_boot/i.test(curUrl) && curUrl.startsWith('http') && !curUrl.includes('about:')) {
            log("  ✅ ZO space booted (URL changed at " + ((i+1)*2) + "s): " + curUrl.substring(0, 80));
            bootDone = true;
            break;
          }
          
          // ★ Secondary: check page content for boot progress
          if (i % 3 === 0) {
            const txt = await page.evaluate(() => document.body.innerText.substring(0, 300)).catch(() => "");
            const pct = txt.match(/(\d+\.?\d*)%/);
            if (pct) log("  Boot progress: " + pct[1] + "% (" + ((i+1)*2) + "s)");
            
            // Detect if space is actually running (even if URL hasn't changed yet)
            if (/home|files|automations|chat|dashboard|workspace/i.test(txt) && !/start computer|restore|wake|save|dormant/i.test(txt)) {
              log("  ✅ ZO space active (content detected at " + ((i+1)*2) + "s)");
              bootDone = true;
              break;
            }
            
            if (i % 15 === 0 && i > 0) {
              log("  Still booting... (" + ((i+1)*2) + "s) " + txt.substring(0, 80).replace(/\n/g, ' | '));
            }
          }
          
          // Detect stuck states and auto-recover
          if (i > 10 && i % 10 === 0) {
            const fullText = await page.evaluate(() => document.body.innerText).catch(() => "");
            if (/not responding|not reachable|timed out|error|something went wrong/i.test(fullText)) {
              log("  ⚠️ Space stuck, auto-recovery...");
              await page.evaluate(() => {
                for (const btn of document.querySelectorAll('button, a[role=button]')) {
                  if (/retry|refresh|try again|reload/i.test((btn.textContent || '').trim())) { btn.click(); return; }
                }
              }).catch(() => {});
            }
          }
        }
        if (!bootDone) {
          throw new Error("ZO space did not boot within 5 minutes");
        }
      }
    }

    // ★ 单一智能轮询：合并聊天界面检测 + ZO空间就绪检测
    // 2s间隔，多维度检测，快就快退出，慢就耐心等（最长5分钟）
    log("  Smart polling for chat interface + ZO space readiness...");
    let chatReady = false;
    for (let i = 0; i < 150; i++) {
      await new Promise(r => setTimeout(r, 2000));
      const url = page.url();
      
      try {
        const bodyText = await page.evaluate(() => document.body.innerText.substring(0, 1500)).catch(() => "");
        if (!bodyText) continue;
        
        // ★ Multi-dimensional readiness detection (any 2 of 4 = ready)
        let score = 0;
        const signals = [];
        
        // Signal 1: Sidebar navigation items
        if (/\bhome\b/i.test(bodyText) && (/\bfiles\b|automations|browser|skills|hosting|integrations|settings/i.test(bodyText))) {
          score++;
          signals.push("sidebar");
        }
        
        // Signal 2: Chat input area (textarea, send button, placeholder text)
        const hasChatInput = await page.evaluate(() => {
          const inputs = document.querySelectorAll('textarea, input[type=text], [contenteditable=true]');
          for (const inp of inputs) {
            if (inp.offsetWidth > 100 && inp.offsetHeight > 0) return true;
          }
          for (const btn of document.querySelectorAll('button, [role=button]')) {
            if (/send|submit/i.test((btn.textContent || '').trim()) && btn.offsetWidth > 0) return true;
          }
          return false;
        }).catch(() => false);
        if (hasChatInput) { score++; signals.push("chatInput"); }
        
        // Signal 3: Chat content / welcome message / model selector
        if (/welcome|new chat|start|GPT|gpt|claude|model|what can|ask me|how can|type.*message|send.*message/i.test(bodyText)) {
          score++;
          signals.push("chatContent");
        }
        
        // Signal 4: URL is on workspace (not _boot, not signup)
        const isWorkspace = /zo\.computer\/?(\?|$|\/chat|\/home|\/dashboard)/i.test(url) 
          && !/_boot|signup|email-login|verify/i.test(url);
        if (isWorkspace) { score++; signals.push("workspaceURL"); }
        
        // ★ Ready when score >= 2 (at least 2 independent signals confirm)
        if (score >= 2) {
          log("  ✅ Chat interface ready (" + ((i+1)*2) + "s, signals: " + signals.join("+") + ")");
          chatReady = true;
          break;
        }
        
        // Log progress periodically
        if (i % 10 === 0 && i > 0) {
          log("  Waiting... (" + ((i+1)*2) + "s, score: " + score + "/4, signals: " + (signals.join(",") || "none") + ")");
          log("  URL: " + url.substring(0, 70) + " | Text: " + bodyText.substring(0, 80).replace(/\n/g, ' '));
        }
        
        // If still on _boot or loading page, check for boot progress
        if (/_boot/i.test(url)) {
          const pct = bodyText.match(/(\d+\.?\d*)%/);
          if (pct && i % 5 === 0) log("  Boot: " + pct[1] + "%");
        }
      } catch(e) {
        if (i % 10 === 0) log("  Poll error: " + e.message.substring(0, 60));
      }
    }
    
    if (!chatReady) {
      log("  ⚠️ Chat interface not fully detected after 5min, proceeding with current state...");
      log("  Current URL: " + page.url().substring(0, 80));
    }

    // === Get Credentials (AT + Cookie AT) ===
    const needZoAT = !hasAT(email);
    const needCookieAT = !hasCookieAT(email);
    log("[CRED] Need zo_sk AT: " + needZoAT + " | Need Cookie AT: " + needCookieAT);

    let accessToken = null;
    let cookieATValue = null;

    // Step A: Get Cookie AT first (while still on workspace, cookies are fresh)
    if (needCookieAT) {
      log("[COOKIE] Extracting Cookie AT from browser...");
      const cookie = await getCookieATFromBrowser(browser, handle, log);
      if (cookie && cookie.value) {
        cookieATValue = cookie;
        saveCookieAT(email, handle, cookie, log);
      } else {
        log("[COOKIE] ⚠️ Could not extract Cookie AT (will retry after AT fetch)");
      }
    } else {
      log("[COOKIE] Already have Cookie AT, skipping");
    }

    // Step B: Get zo_sk AT (Settings → Advanced → Create API Key)
    if (needZoAT) {
      log("[AT] Fetching zo_sk API key...");
      accessToken = await fetchAccessToken(page, handle, config, log);
      if (accessToken) {
        const atFile = path.join(AT_DIR, email + ".txt");
        const content = `email: ${email}\nhandle: ${handle}\nzoAddress: ${handle}.zo.computer\naccessToken: ${accessToken}\ntime: ${new Date().toISOString()}\n`;
        fs.writeFileSync(atFile, content, "utf8");
        log("✅ AT saved: " + atFile);
      } else {
        log("[AT] ⚠️ Failed to get zo_sk API key");
      }
    } else {
      log("[AT] Already have zo_sk AT, skipping");
    }

    // Step C: Retry Cookie AT if first attempt failed (navigating to settings may have refreshed cookies)
    if (needCookieAT && !cookieATValue) {
      log("[COOKIE] Retrying Cookie AT extraction...");
      const cookie2 = await getCookieATFromBrowser(browser, handle, log);
      if (cookie2 && cookie2.value) {
        cookieATValue = cookie2;
        saveCookieAT(email, handle, cookie2, log);
      } else {
        log("[COOKIE] ❌ Cookie AT extraction failed after retry");
      }
    }

    // === Result ===
    if (accessToken || cookieATValue) {
      const resultLine = JSON.stringify({
        email, handle,
        accessToken: accessToken ? accessToken.substring(0, 20) + "..." : null,
        cookieAT: cookieATValue ? cookieATValue.value.substring(0, 30) + "..." : null,
        time: new Date().toISOString(), status: "success"
      }) + "\n";
      fs.appendFileSync(RESULTS_FILE, resultLine, "utf8");
      return { email, handle, accessToken, cookieAT: cookieATValue?.value, status: "success" };
    } else {
      throw new Error("Failed to get both AT and Cookie AT");
    }

  } catch (e) {
    log("❌ Error: " + e.message);
    
    // ★ Detect Microsoft account blocked (AADSTS70000)
    const isBlocked = /AADSTS70000|service abuse|account.*locked|account.*disabled/i.test(e.message);
    const status = isBlocked ? "blocked" : "fail";
    
    const resultLine = JSON.stringify({ email, error: e.message, time: new Date().toISOString(), status }) + "\n";
    fs.appendFileSync(RESULTS_FILE, resultLine, "utf8");
    
    // ★ Save blocked accounts to separate file
    if (isBlocked) {
      const blockedFile = path.join(REGISTERED_DIR, "blocked_accounts.txt");
      fs.appendFileSync(blockedFile, email + "\n", "utf8");
      log("⚠️ Account blocked by Microsoft, marked as unusable");
    }
    
    return { email, error: e.message, status };
  } finally {
    // ★ ALWAYS close the browser and KILL its entire process tree
    if (browser) {
      try {
        // Fallback: if PID wasn't captured at launch, get it now
        let pid = browserPid;
        if (!pid) {
          try { pid = browser.process()?.pid; } catch(e) {}
        }
        if (pid) {
          killProcessTree(pid);
          // Remove from global tracker
          const idx = scriptLaunchedPids.indexOf(pid);
          if (idx >= 0) scriptLaunchedPids.splice(idx, 1);
        }
        await browser.close().catch(() => {});
        // Second pass: catch stragglers spawned during close()
        await new Promise(r => setTimeout(r, 3000));
        if (pid) killProcessTree(pid);
      } catch(e) {}
    }
    // ★ Aggressive temp dir cleanup (retries)
    cleanupTempDir(tempDir);
    // ★ Release browser slot so next worker can start
    releaseBrowserSlot();
  }
}

// ===== Main =====
async function main() {
  const mode = process.argv[2] || "single";  // "single" or "parallel"
  const concurrency = parseInt(process.argv[3] || "1");
  
  console.log("=== ZO Batch AT Retrieval ===");
  console.log("Mode: " + mode + " | Concurrency: " + concurrency);

  // Parse accounts
  const accounts = parseAccounts(ZO_FILE);
  console.log("Total accounts in zo.txt: " + accounts.length);

  // Check existing ATs and Cookie ATs
  const existingATs = getExistingATs();
  console.log("Already have AT (zo_sk): " + existingATs.size);

  // Count existing Cookie ATs
  let existingCookieATs = new Set();
  if (fs.existsSync(COOKIE_AT_DIR)) {
    existingCookieATs = new Set(fs.readdirSync(COOKIE_AT_DIR).filter(f => f.endsWith(".txt")).map(f => f.replace(".txt", "")));
  }
  console.log("Already have Cookie AT: " + existingCookieATs.size);

  // Filter accounts that need either AT or Cookie AT
  const needWork = accounts.filter(a => !existingATs.has(a.email) || !existingCookieATs.has(a.email));
  const needBoth = needWork.filter(a => !existingATs.has(a.email) && !existingCookieATs.has(a.email)).length;
  const needOnlyCookie = needWork.filter(a => existingATs.has(a.email) && !existingCookieATs.has(a.email)).length;
  const needOnlyAT = needWork.filter(a => !existingATs.has(a.email) && existingCookieATs.has(a.email)).length;
  console.log("Accounts needing work: " + needWork.length + " (both: " + needBoth + ", only Cookie AT: " + needOnlyCookie + ", only zo_sk AT: " + needOnlyAT + ")");

  if (needWork.length === 0) {
    console.log("All accounts already have both AT and Cookie AT!");
    return;
  }

  // Alias for backward compat
  const needAT = needWork;

  // Config
  const config = {
    browserType: "edge",
    registeredDir: REGISTERED_DIR,
    tokenKeyName: "MyApiKey",
    fetchAccessToken: true,
  };

  // Ensure AT and Cookie AT directories exist
  if (!fs.existsSync(AT_DIR)) fs.mkdirSync(AT_DIR, { recursive: true });
  if (!fs.existsSync(COOKIE_AT_DIR)) fs.mkdirSync(COOKIE_AT_DIR, { recursive: true });

  if (mode === "single") {
    // Single-threaded: process one by one
    console.log("\n=== Processing " + Math.min(needAT.length, 2) + " accounts (single-threaded test) ===\n");
    
    for (let i = 0; i < Math.min(needAT.length, 2); i++) {
      const account = needAT[i];
      console.log("\n" + "=".repeat(60));
      console.log(`[${i+1}/${Math.min(needAT.length, 2)}] ${account.email}`);
      console.log("=".repeat(60));
      
      const log = (msg) => {
        const ts = new Date().toLocaleTimeString("en-US", { hour12: false });
        console.log(`[${ts}] ${msg}`);
      };

      const result = await loginAndGetAT(account, config, log);
      console.log("Result: " + result.status + (result.error ? " (" + result.error + ")" : ""));
      
      // Wait between accounts
      if (i < needAT.length - 1) {
        console.log("Waiting 5s before next account...");
        await new Promise(r => setTimeout(r, 5000));
      }
    }
  } else if (mode === "parallel") {
    // Worker pool: each worker pulls from queue, no batch waiting
    console.log("\n=== Processing " + needAT.length + " accounts (worker pool, concurrency=" + concurrency + ") ===\n");
    
    const MAX_RETRIES = 1; // Only retry transient errors once
    const queue = needAT.map(a => ({ account: a, retries: 0 }));
    const results = [];
    let completed = 0;
    let skipped = 0;
    const total = needAT.length;
    const startTime = Date.now();
    
    // Load blocked accounts
    const blockedAccounts = loadBlockedAccounts();
    console.log("Blocked accounts loaded: " + blockedAccounts.size);

    async function worker(workerId) {
      while (true) {
        const task = queue.shift();
        if (!task) break;
        
        const { account, retries } = task;
        
        // ★ Dynamic check: skip only if BOTH credentials are obtained
        if (hasAT(account.email) && hasCookieAT(account.email)) {
          skipped++;
          console.log(`[W${workerId}] ⏭️ Skipped (has both AT + Cookie AT): ${account.email.substring(0, 30)}`);
          continue;
        }
        
        // Check blocked list
        if (blockedAccounts.has(account.email)) {
          skipped++;
          console.log(`[W${workerId}] ⏭️ Skipped (blocked): ${account.email.substring(0, 30)}`);
          continue;
        }
        
        const tag = account.email.split("@")[0].substring(0, 15);
        const log = (msg) => {
          const ts = new Date().toLocaleTimeString("en-US", { hour12: false });
          console.log(`[${ts}] [W${workerId}] [${tag}] ${msg}`);
        };
        
        log(`Starting (${retries > 0 ? "retry " + retries : "attempt 1"}) [${completed}/${total} done, ${skipped} skipped]`);
        
        try {
          const result = await loginAndGetAT(account, config, log);
          completed++;
          
          if (result.status === "success") {
            log(`✅ SUCCESS [${completed}/${total}]`);
            results.push(result);
          } else if (result.status === "blocked") {
            blockedAccounts.add(account.email);
            log(`⚠️ BLOCKED, skipping [${completed}/${total}]`);
            results.push(result);
          } else {
            const errorClass = classifyError(result.error);
            if (errorClass === "permanent") {
              log(`❌ PERMANENT FAIL, no retry: ${result.error}`);
              results.push(result);
            } else if (errorClass === "transient" && retries < MAX_RETRIES) {
              log(`🔄 TRANSIENT FAIL, retrying (${retries+1}/${MAX_RETRIES}): ${result.error}`);
              queue.push({ account, retries: retries + 1 });
            } else {
              log(`❌ FAILED: ${result.error}`);
              results.push(result);
            }
          }
        } catch (e) {
          completed++;
          const errorClass = classifyError(e.message);
          if (errorClass === "transient" && retries < MAX_RETRIES) {
            log(`🔄 Exception, retrying: ${e.message}`);
            queue.push({ account, retries: retries + 1 });
          } else {
            log(`❌ FAILED: ${e.message}`);
            results.push({ email: account.email, error: e.message, status: "fail", errorClass });
          }
        }
        
        await new Promise(r => setTimeout(r, 500));
      }
      console.log(`[Worker ${workerId}] No more tasks, exiting.`);
    }

    // Stagger worker starts
    const workers = [];
    for (let i = 0; i < concurrency; i++) {
      workers.push(worker(i + 1));
      if (i < concurrency - 1) {
        console.log(`  Worker ${i+1} started, waiting 1s before worker ${i+2}...`);
        await new Promise(r => setTimeout(r, 1000));
      }
    }
    
    await Promise.all(workers);
    
    // Summary
    const elapsed = Math.round((Date.now() - startTime) / 1000);
    console.log("\n\n" + "=".repeat(60));
    console.log("=== FINAL SUMMARY ===");
    console.log("=".repeat(60));
    const success = results.filter(r => r.status === "success");
    const fail = results.filter(r => r.status === "fail");
    const blocked = results.filter(r => r.status === "blocked");
    
    console.log(`⏱️ Time: ${elapsed}s (${Math.round(elapsed/60)}min)`);
    console.log(`✅ Success: ${success.length}`);
    console.log(`❌ Failed: ${fail.length}`);
    console.log(`⚠️ Blocked: ${blocked.length}`);
    console.log(`⏭️ Skipped: ${skipped}`);
    
    // Count final credential totals
    const finalATs = fs.existsSync(AT_DIR) ? fs.readdirSync(AT_DIR).filter(f => f.endsWith(".txt")).length : 0;
    const finalCookieATs = fs.existsSync(COOKIE_AT_DIR) ? fs.readdirSync(COOKIE_AT_DIR).filter(f => f.endsWith(".txt")).length : 0;
    console.log(`\n📊 Final totals: zo_sk AT: ${finalATs} | Cookie AT: ${finalCookieATs}`);
    const atGot = success.filter(r => r.accessToken).length;
    const cookieGot = success.filter(r => r.cookieAT).length;
    console.log(`   This run: zo_sk AT +${atGot} | Cookie AT +${cookieGot}`);
    
    if (success.length > 0) {
      console.log(`\n成功账号:`);
      for (const r of success) {
        console.log(`  ✅ ${r.email} (${r.handle})${r.accessToken ? ' [AT]' : ''}${r.cookieAT ? ' [CookieAT]' : ''}`);
      }
    }
    if (fail.length > 0) {
      console.log("\nFailed:");
      for (const r of fail) {
        console.log(`  ❌ ${r.email} — ${r.error}`);
      }
    }
  }
}

main().catch(e => { console.error(e); process.exit(1); });
