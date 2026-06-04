/**
 * ZO Computer Batch Register - Server v3
 * Uses puppeteer.launch() with pipe-mode CDP (undetectable by Turnstile)
 */
const express = require("express");
const http = require("http");
const { WebSocketServer } = require("ws");
const puppeteer = require("E:\\API获取工具\\ZO注册\\node_modules\\puppeteer-core");
const { readFileSync, writeFileSync, appendFileSync, readdirSync, renameSync, mkdirSync, existsSync } = require("fs");
const { join } = require("path");

// ========== Config ==========
const WEB_PORT = 3456;
const EMAIL_DIR = "C:\\Users\\XZXyuan\\Downloads\\批量注册邮箱\\已经使用";
const REGISTERED_DIR = "E:\\API获取工具\\ZO注册\\registered";
const RESULTS_FILE = join(REGISTERED_DIR, "results.jsonl");
const SIGNUP_URL = "https://www.zo.computer/signup";
const GRAPH_TOKEN_URL = "https://login.microsoftonline.com/consumers/oauth2/v2.0/token";
const GRAPH_MAIL_URL = "https://graph.microsoft.com/v1.0/me/messages";
const CHROME_PATH = "C:\\Users\\XZXyuan\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe";
const DEFAULT_CONCURRENCY = 1;

if (!existsSync(REGISTERED_DIR)) mkdirSync(REGISTERED_DIR, { recursive: true });

// ========== State ==========
const state = {
  emails: [], running: false, concurrency: DEFAULT_CONCURRENCY,
  stats: { total: 0, pending: 0, success: 0, fail: 0, inProgress: 0 },
  workers: [], browser: null,
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
    await sleep(5000);
  }
  return null;
}

// ========== Register one email ==========
async function registerOne(browser, emailItem) {
  const { email, password, clientId, refreshToken } = emailItem;
  const log = (msg) => { broadcast("log", { email, msg }); console.log("[" + email.substring(0, 20) + "] " + msg); };

  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  page.setDefaultTimeout(60000);
  await page.setViewport({ width: 1440, height: 900 });
  
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
    Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
    Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
    window.chrome = { runtime: {} };
    delete window.cdc_adoQpoasnfa76pfcZLmcfl_Array;
    delete window.cdc_adoQpoasnfa76pfcZLmcfl_Promise;
    delete window.cdc_adoQpoasnfa76pfcZLmcfl_Symbol;
  });

  try {
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

    const sendTime = new Date(Date.now() - 10000); // 10s buffer for clock skew
    log("[4/7] Email sent! Polling inbox...");

    // Step 4: Poll for magic link
    const result = await pollMagicLink(email, clientId, refreshToken, sendTime, log);
    if (!result) throw new Error("No magic link in 3 min");
    const { link, newRefreshToken } = result;
    log("  Got magic link!");

    if (newRefreshToken !== refreshToken) {
      writeFileSync(join(EMAIL_DIR, email + ".txt"), [email, password, clientId, newRefreshToken].join("----"), "utf-8");
    }

    // Step 5: Open magic link - use generous timeout, catch timeout and continue
    log("[5/7] Opening magic link...");
    try {
      await page.goto(link, { waitUntil: "domcontentloaded", timeout: 60000 });
    } catch (navErr) {
      if (/timeout/i.test(navErr.message)) {
        log("  Navigation timeout (expected with Turnstile), continuing...");
      } else if (/net::ERR_/i.test(navErr.message)) {
        throw new Error("Network error opening link: " + navErr.message);
      } else {
        log("  Nav error: " + navErr.message + ", continuing...");
      }
    }
    await sleep(3000);

    // Step 5b: Wait for Turnstile → "Continue in browser" → handle page
    log("  Waiting for Turnstile/redirect...");
    let reachedHandlePage = false;
    let clickedContinueOnce = false;
    for (let i = 0; i < 60; i++) {
      const txt = await getBodyText(page, 600);
      const currentUrl = page.url();

      if (/choose your handle/i.test(txt) || currentUrl.includes("/signup") && /handle/i.test(txt)) {
        log("  Reached handle page!");
        reachedHandlePage = true;
        break;
      }

      if (/invalid|expired/i.test(txt) && !/redirecting|verif/i.test(txt)) {
        throw new Error("Link expired after click");
      }

      // Check Turnstile status before clicking
      const turnstileStatus = await page.evaluate(() => {
        const iframes = document.querySelectorAll('iframe[src*="turnstile"], iframe[src*="challenges"]');
        if (iframes.length === 0) return 'no_iframe';
        // Check if Turnstile checkbox is checked
        for (const iframe of iframes) {
          try {
            const doc = iframe.contentDocument;
            if (doc) {
              const checked = doc.querySelector('[data-checked]');
              if (checked) return 'checked';
            }
          } catch(e) {}
        }
        return 'pending';
      }).catch(() => 'unknown');

      if (i % 5 === 0) log("  [" + i * 3 + "s] Turnstile: " + turnstileStatus + " | " + txt.substring(0, 50).replace(/\n/g, " "));

      // Only click "Continue in browser" if Turnstile seems done or no iframe found, and haven't clicked yet
      if (!clickedContinueOnce || turnstileStatus === 'checked' || turnstileStatus === 'no_iframe') {
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
          try {
            await page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 20000 }).catch(() => {});
          } catch (e) {}
          await sleep(5000);
          const afterTxt = await getBodyText(page, 300);
          if (/choose your handle/i.test(afterTxt)) {
            log("  Reached handle page after continue!");
            reachedHandlePage = true;
            break;
          }
          // If still on same page, wait before retrying
          if (!/check your email/i.test(afterTxt)) {
            log("  After click: " + afterTxt.substring(0, 60).replace(/\n/g, " "));
          }
          continue;
        }
      }

      if (/redirecting/i.test(txt)) {
        log("  Redirecting...");
        await sleep(5000);
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
  } finally {
    await page.close().catch(() => {});
    await context.close().catch(() => {});
  }
}

// ========== Batch runner ==========
async function runBatch() {
  if (state.running) return;
  state.running = true;
  broadcast("batch_start", { concurrency: state.concurrency });

  const pending = state.emails.filter(e => e.status === "pending");
  if (pending.length === 0) { state.running = false; broadcast("batch_done", state.stats); return; }

  // Launch browser with puppeteer.launch() — pipe-mode CDP, undetectable
  let browser;
  try {
    console.log("[INFO] Launching Chrome...");
    browser = await puppeteer.launch({
      executablePath: CHROME_PATH,
      headless: false,
      protocolTimeout: 300000,
      args: [
        "--no-first-run",
        "--disable-features=Translate",
        "--disable-blink-features=AutomationControlled",
        "--window-size=1440,900",
      ],
      defaultViewport: { width: 1440, height: 900 },
    });
    console.log("[INFO] Chrome launched (pipe CDP)");
    state.browser = browser;
    
    // Apply stealth patches to all new pages
    browser.on('targetcreated', async (target) => {
      const page = await target.page().catch(() => null);
      if (!page) return;
      await page.evaluateOnNewDocument(() => {
        // Hide webdriver
        Object.defineProperty(navigator, 'webdriver', { get: () => false });
        // Fix plugins
        Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
        // Fix languages
        Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
        // Fix permissions
        const originalQuery = window.navigator.permissions.query;
        window.navigator.permissions.query = (parameters) => (
          parameters.name === 'notifications' ?
            Promise.resolve({ state: Notification.permission }) :
            originalQuery(parameters)
        );
        // Hide automation indicators
        delete window.cdc_adoQpoasnfa76pfcZLmcfl_Array;
        delete window.cdc_adoQpoasnfa76pfcZLmcfl_Promise;
        delete window.cdc_adoQpoasnfa76pfcZLmcfl_Symbol;
        // Chrome runtime
        window.chrome = { runtime: {} };
      });
    });
  } catch (e) {
    console.error("[ERROR] Cannot launch Chrome:", e.message);
    broadcast("error", { msg: "Cannot launch Chrome: " + e.message });
    state.running = false;
    return;
  }

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
      const result = await registerOne(browser, emailItem);
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
  state.browser = null;
  broadcast("batch_done", state.stats);
  try { await browser.close(); } catch (e) {}
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
app.get("/api/status", (req, res) => { res.json({ running: state.running, stats: state.stats, workers: state.workers, concurrency: state.concurrency }); });
app.get("/api/registered", (req, res) => {
  const files = existsSync(REGISTERED_DIR) ? readdirSync(REGISTERED_DIR).filter(f => f.endsWith(".txt")) : [];
  const results = [];
  if (existsSync(RESULTS_FILE)) { const lines = readFileSync(RESULTS_FILE, "utf-8").trim().split("\n").filter(Boolean); for (const line of lines) { try { results.push(JSON.parse(line)); } catch (e) {} } }
  res.json({ files, results });
});
app.post("/api/concurrency", (req, res) => { state.concurrency = Math.max(1, Math.min(10, (req.body && req.body.concurrency) || 3)); res.json({ ok: true, concurrency: state.concurrency }); });

const server = http.createServer(app);
const wss = new WebSocketServer({ server });
wss.on("connection", (ws) => {
  wsClients.add(ws);
  ws.on("close", () => wsClients.delete(ws));
  ws.on("error", () => wsClients.delete(ws));
  ws.send(JSON.stringify({ type: "init", data: { stats: state.stats, workers: state.workers, running: state.running, concurrency: state.concurrency } }));
});

function killPortAndStart() {
  const { execSync } = require("child_process");
  try {
    const out = execSync("netstat -ano | findstr \":" + WEB_PORT + "\" | findstr \"LISTENING\"", { encoding: "utf-8" });
    const match = out.match(/\s(\d+)\s*$/);
    if (match) { console.log("[INFO] Killing old process on port " + WEB_PORT + " (PID: " + match[1] + ")"); execSync("taskkill /PID " + match[1] + " /F", { stdio: "ignore" }); }
  } catch (e) {}
  server.listen(WEB_PORT, () => {
    console.log(""); console.log("  ZO Batch Register Server v3"); console.log("  Frontend: http://localhost:" + WEB_PORT); console.log("  Concurrency: " + state.concurrency); console.log("  Email dir: " + EMAIL_DIR); console.log("");
  });
}
killPortAndStart();

process.on("uncaughtException", (err) => { console.error("[ERROR]", err.message); });
process.on("unhandledRejection", (err) => { console.error("[ERROR]", err); });
