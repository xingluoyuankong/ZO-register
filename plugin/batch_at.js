/**
 * batch_at.js — 批量获取已注册账号的 Access Token
 * 
 * 流程：
 * 1. 读取 zo.txt 凭证
 * 2. 检查哪些账号已有 AT
 * 3. 逐个登录 → 获取 AT
 * 4. 先单线程验证，再多线程并行
 */

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const { launchBrowser, fetchAccessToken, getMailToken, findMagicLink, pollMagicLink } = require("./zo_register");

// ===== Pre-flight cleanup =====
function preflightCleanup() {
  // Kill orphaned browser processes
  try { execSync("taskkill /F /IM msedge.exe 2>nul", { stdio: "ignore" }); } catch(e) {}
  try { execSync("taskkill /F /IM chrome.exe 2>nul", { stdio: "ignore" }); } catch(e) {}
  // Remove leftover temp dirs
  const tmpBase = path.join("E:\\Openclaw\\tmp");
  if (fs.existsSync(tmpBase)) {
    const dirs = fs.readdirSync(tmpBase).filter(d => d.startsWith("zo_reg_"));
    for (const d of dirs) {
      try { fs.rmSync(path.join(tmpBase, d), { recursive: true, force: true }); } catch(e) {}
    }
    console.log(`Cleaned ${dirs.length} orphaned temp dirs`);
  }
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

// ===== Browser count enforcement =====
const MAX_BROWSERS = 4;
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

const ZO_FILE = path.join("C:\\Users\\XZXyuan\\Downloads", "zo.txt");
const REGISTERED_DIR = path.join(__dirname, "..", "registered");
const AT_DIR = path.join(REGISTERED_DIR, "Access Tokens");
const RESULTS_FILE = path.join(REGISTERED_DIR, "at_results.jsonl");

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
    accounts.push({
      email,
      password: parts[1].trim(),
      clientId: parts[2].trim(),
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

// ===== Login + Get AT for one account =====
async function loginAndGetAT(account, config, log) {
  const { email, clientId, refreshToken } = account;
  let browser, tempDir;
  
  try {
    // ★ Acquire browser slot (blocks if MAX_BROWSERS reached)
    await acquireBrowserSlot();
    log("[BROWSER] Slot acquired (active: " + activeBrowsers + "/" + MAX_BROWSERS + ")");
    
    // Launch browser
    const launched = await launchBrowser(config, log);
    browser = launched.browser;
    tempDir = launched.tempDir;
    const page = launched.page;
    page.setDefaultTimeout(60000);
    await page.setViewport({ width: 1440, height: 900 });

    // === Step 1: Open signup/login page ===
    log("[1/5] Opening ZO login page...");
    await page.goto("https://www.zo.computer/signup", { waitUntil: "domcontentloaded", timeout: 45000 });
    await new Promise(r => setTimeout(r, 2000));

    // === Step 2: Click "Email me a sign-up link" === robust retry
    log("[2/5] Clicking email button...");
    let clicked = false;
    for (let attempt = 0; attempt < 10 && !clicked; attempt++) {
      if (attempt > 0) await new Promise(r => setTimeout(r, 3000));
      const ready = await page.evaluate(() => document.readyState).catch(() => "unknown");
      if (ready !== "complete" && ready !== "interactive") {
        log("  Page not ready (" + ready + "), waiting... (attempt " + (attempt+1) + ")");
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
        log("  Button not found yet (attempt " + (attempt+1) + "/10)");
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

    // Wait for confirmation
    let emailSent = false;
    for (let i = 0; i < 15; i++) {
      await new Promise(r => setTimeout(r, 2000));
      const txt = await page.evaluate(() => document.body.innerText.substring(0, 500)).catch(() => "");
      if (/check your email|login link/i.test(txt)) { emailSent = true; break; }
    }
    if (!emailSent) throw new Error("Email not sent");
    log("  Email sent!");

    // === Step 4: Get magic link via Graph API ===
    log("[4/5] Polling for magic link...");
    const sendTime = new Date();
    const result = await pollMagicLink(email, clientId, refreshToken, sendTime, log, config);
    if (!result || !result.link) throw new Error("No magic link found");
    log("  Magic link found!");

    // === Step 5: Open magic link → login → boot → settings → AT ===
    log("[5/5] Opening magic link...");
    await page.goto(result.link, { waitUntil: "domcontentloaded", timeout: 30000 });
    await new Promise(r => setTimeout(r, 5000));

    // Wait for verify redirect to complete
    for (let i = 0; i < 30; i++) {
      const url = page.url();
      if (/zo\.computer/.test(url) && !/verify|email-login/i.test(url)) {
        log("  ✅ Login redirect done: " + url.substring(0, 80));
        break;
      }
      await new Promise(r => setTimeout(r, 2000));
    }

    // Extract handle — multiple strategies with retries
    let handle = "";

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

    if (!handle) {
      throw new Error("Cannot determine ZO handle for " + email);
    }

    // === Boot dormant ZO space ===
    log("  Navigating to " + handle + ".zo.computer/_boot ...");
    await page.goto("https://" + handle + ".zo.computer/_boot", { waitUntil: "domcontentloaded", timeout: 30000 });
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

      // Wait for ZO space to boot up (redirect away from _boot)
      if (wakeClicked) {
        log("  Waiting for ZO space to boot...");
        for (let i = 0; i < 100; i++) {
          await new Promise(r => setTimeout(r, 3000));
          bootUrl = page.url();
          if (!/_boot/i.test(bootUrl)) {
            log("  ✅ ZO space booted! URL: " + bootUrl.substring(0, 80));
            break;
          }
          // Check page text for boot progress
          if (i % 5 === 0) {
            const txt = await page.evaluate(() => document.body.innerText.substring(0, 200)).catch(() => "");
            log("  Boot page text: " + txt.substring(0, 100).replace(/\n/g, ' | '));
          }
          // If stuck on "Not responding" / "Not reachable", just wait for auto-recovery
          if (i > 5 && i % 5 === 0) {
            const pageText = await page.evaluate(() => document.body.innerText).catch(() => "");
            if (/not responding|not reachable|timed out|error/i.test(pageText)) {
              log("  ⚠️ Space stuck ('Not responding'), waiting for auto-recovery...");
            }
          }
        }
        if (/_boot/i.test(page.url())) {
          throw new Error("ZO space did not boot within 5 minutes");
        }
      }
    }

    // Ensure we're in the chat interface — wait for full load
    log("  Waiting for chat interface to fully load...");
    for (let i = 0; i < 40; i++) {
      await new Promise(r => setTimeout(r, 3000));
      const url = page.url();
      if (/zo\.computer\/?$/.test(url) || /zo\.computer\/chat/i.test(url) || /zo\.computer\/signup/i.test(url)) {
        const bodyText = await page.evaluate(() => document.body.innerText.substring(0, 500)).catch(() => "");
        if (/home|files|automations|integrations|skills|browser|hosting|首页|文件|自动化|集成|技能|浏览器|托管/i.test(bodyText) || /chat|message|ask|hello|hi|welcome|what can|how can|type/i.test(bodyText)) {
          log("  ✅ Chat interface loaded (sidebar detected)");
          break;
        }
      }
      if (i % 5 === 0) log("  Still waiting for chat interface... (" + (i*3) + "s)");
    }
    log("  Current page: " + page.url().substring(0, 80));

    // ★ Extra wait for ZO space to fully initialize before accessing settings
    log("  Waiting 15s for ZO space to fully initialize...");
    await new Promise(r => setTimeout(r, 15000));

    // === Get Access Token ===
    const accessToken = await fetchAccessToken(page, handle, config, log);
    
    if (accessToken) {
      // Save AT
      const atFile = path.join(AT_DIR, email + ".txt");
      const content = `email: ${email}\nhandle: ${handle}\nzoAddress: ${handle}.zo.computer\naccessToken: ${accessToken}\ntime: ${new Date().toISOString()}\n`;
      fs.writeFileSync(atFile, content, "utf8");
      log("✅ AT saved: " + atFile);
      
      // Append to results
      const resultLine = JSON.stringify({ email, handle, accessToken: accessToken.substring(0, 20) + "...", time: new Date().toISOString(), status: "success" }) + "\n";
      fs.appendFileSync(RESULTS_FILE, resultLine, "utf8");
      
      return { email, handle, accessToken, status: "success" };
    } else {
      throw new Error("Failed to get access token");
    }

  } catch (e) {
    log("❌ Error: " + e.message);
    const resultLine = JSON.stringify({ email, error: e.message, time: new Date().toISOString(), status: "fail" }) + "\n";
    fs.appendFileSync(RESULTS_FILE, resultLine, "utf8");
    return { email, error: e.message, status: "fail" };
  } finally {
    // ★ Close browser and kill process tree
    if (browser) {
      try {
        const pid = browser.process()?.pid;
        await browser.close();
        if (pid) {
          try { require("child_process").execSync(`taskkill /F /T /PID ${pid} 2>nul`, { stdio: "ignore" }); } catch(e) {}
        }
      } catch(e) {}
      await new Promise(r => setTimeout(r, 2000));
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

  // Check existing ATs
  const existingATs = getExistingATs();
  console.log("Already have AT: " + existingATs.size);

  // Filter accounts that need AT
  const needAT = accounts.filter(a => !existingATs.has(a.email));
  console.log("Need AT: " + needAT.length);

  if (needAT.length === 0) {
    console.log("All accounts already have AT!");
    return;
  }

  // Config
  const config = {
    browserType: "edge",
    registeredDir: REGISTERED_DIR,
    tokenKeyName: "MyApiKey",
    fetchAccessToken: true,
  };

  // Ensure AT directory exists
  if (!fs.existsSync(AT_DIR)) fs.mkdirSync(AT_DIR, { recursive: true });

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
    
    const MAX_RETRIES = 2;
    const queue = needAT.map(a => ({ account: a, retries: 0 }));
    const results = [];
    let completed = 0;
    const total = needAT.length;

    async function worker(workerId) {
      while (true) {
        const task = queue.shift();
        if (!task) break;
        
        const { account, retries } = task;
        const tag = account.email.split("@")[0].substring(0, 15);
        const log = (msg) => {
          const ts = new Date().toLocaleTimeString("en-US", { hour12: false });
          console.log(`[${ts}] [W${workerId}] [${tag}] ${msg}`);
        };
        
        log(`Starting (${retries > 0 ? "retry " + retries + "/" + MAX_RETRIES : "attempt 1"}) [${completed}/${total} done]`);
        
        try {
          const result = await loginAndGetAT(account, config, log);
          completed++;
          
          if (result.status === "success") {
            log(`✅ SUCCESS [${completed}/${total}]`);
            results.push(result);
          } else {
            if (retries < MAX_RETRIES) {
              log(`❌ Fail, retrying (${retries+1}/${MAX_RETRIES}): ${result.error}`);
              queue.push({ account, retries: retries + 1 });
            } else {
              log(`❌ FAILED after ${MAX_RETRIES} retries: ${result.error}`);
              results.push(result);
            }
          }
        } catch (e) {
          completed++;
          if (retries < MAX_RETRIES) {
            log(`❌ Exception, retrying: ${e.message}`);
            queue.push({ account, retries: retries + 1 });
          } else {
            log(`❌ FAILED: ${e.message}`);
            results.push({ email: account.email, error: e.message, status: "fail" });
          }
        }
        
        await new Promise(r => setTimeout(r, 3000));
      }
      console.log(`[Worker ${workerId}] No more tasks, exiting.`);
    }

    // Stagger worker starts
    const workers = [];
    for (let i = 0; i < concurrency; i++) {
      workers.push(worker(i + 1));
      if (i < concurrency - 1) {
        console.log(`  Worker ${i+1} started, waiting 2s before worker ${i+2}...`);
        await new Promise(r => setTimeout(r, 2000));
      }
    }
    
    await Promise.all(workers);
    
    // Summary
    console.log("\n\n" + "=".repeat(60));
    console.log("=== FINAL SUMMARY ===");
    console.log("=".repeat(60));
    const success = results.filter(r => r.status === "success");
    const fail = results.filter(r => r.status === "fail");
    console.log(`✅ Success: ${success.length} | ❌ Failed: ${fail.length}`);
    for (const r of success) {
      console.log(`  ✅ ${r.email} (handle: ${r.handle})`);
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
