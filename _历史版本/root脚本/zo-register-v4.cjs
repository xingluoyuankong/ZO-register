/**
 * ZO Computer 完整注册脚本 v4
 * 
 * 修复：
 *   1. 每个邮箱用自己的 clientId + refreshToken 查邮件
 *   2. 打开等待更久，确保跳转完成
 *   3. 注册完成后保存刷新后的 token
 * 
 * 用法：
 *   node zo-register-v4.cjs              # 注册所有未注册的邮箱
 *   node zo-register-v4.cjs --count 3    # 只注册前3个
 *   node zo-register-v4.cjs --dry-run    # 只发链接，不浏览器注册
 */

const puppeteer = require("E:\\API获取工具\\ZO注册\\node_modules\\puppeteer-core");
const { readFileSync, readdirSync, writeFileSync, existsSync, mkdirSync } = require("fs");
const { join, basename } = require("path");

const CONFIG = {
  EMAIL_DIR: "C:\\Users\\XZXyuan\\Downloads\\批量注册邮箱\\已经使用",
  GRAPH_TOKEN_URL: "https://login.microsoftonline.com/consumers/oauth2/v2.0/token",
  GRAPH_SCOPES: "https://graph.microsoft.com/.default offline_access",
  GRAPH_MESSAGES_API: "https://graph.microsoft.com/v1.0/me/messages",
  POLL_INTERVAL_MS: 5000,
  POLL_MAX_ATTEMPTS: 36,
  LOG_DIR: "E:\\API获取工具\\ZO注册\\logs",
};

function log(msg) {
  const ts = new Date().toISOString().replace("T", " ").replace("Z", "");
  console.log("[" + ts + "] " + msg);
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function parseEmailFile(filePath) {
  const content = readFileSync(filePath, "utf-8").trim();
  const parts = content.split("----").map(s => s.trim());
  if (parts.length < 4) return null;
  return { email: parts[0], password: parts[1], clientId: parts[2], refreshToken: parts[3], file: basename(filePath) };
}

function loadAccounts() {
  return readdirSync(CONFIG.EMAIL_DIR)
    .filter(f => f.endsWith(".txt") && !f.startsWith("tokens_") && !f.includes("combo"))
    .map(f => parseEmailFile(join(CONFIG.EMAIL_DIR, f)))
    .filter(a => a && a.email && a.refreshToken && a.clientId);
}

// ==================== Graph API ====================

async function refreshToken(clientId, refreshToken) {
  const body = new URLSearchParams({
    client_id: clientId, grant_type: "refresh_token", refresh_token: refreshToken, scope: CONFIG.GRAPH_SCOPES,
  });
  const resp = await fetch(CONFIG.GRAPH_TOKEN_URL, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: body.toString(),
  });
  if (!resp.ok) throw new Error("Token refresh failed: " + resp.status);
  const data = await resp.json();
  return { accessToken: data.access_token, nextRefreshToken: data.refresh_token || refreshToken };
}

async function fetchLatestMessages(accessToken, top) {
  top = top || 20;
  const url = CONFIG.GRAPH_MESSAGES_API + "?$top=" + top + "&$select=id,subject,from,body,bodyPreview,receivedDateTime&$orderby=receivedDateTime%20desc";
  const resp = await fetch(url, { headers: { Authorization: "Bearer " + accessToken } });
  if (!resp.ok) throw new Error("Graph API failed: " + resp.status);
  return (await resp.json()).value || [];
}

function extractMagicLink(messages) {
  for (const msg of messages) {
    const body = msg.body || {};
    const htmlBody = (body.contentType === "html" && body.content) || "";
    const textBody = (body.contentType === "text" && body.content) || "";
    const combined = (msg.subject || "") + " " + (msg.bodyPreview || "") + " " + textBody + " " + htmlBody;
    
    const links = combined.match(/https?:\/\/[^\s"'<>\]]*(?:zo\.computer|zocomputer|cello\.so)[^\s"'<>\]]*/gi) || [];
    for (let link of links) {
      link = link.replace(/[)\]>,;:.!?]+$/, "").replace(/&amp;/g, "&");
      if (!link.match(/\.(png|jpg|css|js|svg|ico|woff)/i) && !link.match(/\/pricing|\/models|\/mission|\/blog/)) {
        return { link, subject: msg.subject, from: msg.from?.emailAddress?.name || "?" };
      }
    }
  }
  return null;
}

// ==================== 日志 ====================

function saveResult(result) {
  if (!existsSync(CONFIG.LOG_DIR)) mkdirSync(CONFIG.LOG_DIR, { recursive: true });
  const f = join(CONFIG.LOG_DIR, "results_" + new Date().toISOString().slice(0, 10) + ".jsonl");
  writeFileSync(f, JSON.stringify({ ...result, ts: new Date().toISOString() }) + "\n", { flag: "a" });
}

function loadRegistered() {
  const set = new Set();
  if (!existsSync(CONFIG.LOG_DIR)) return set;
  const files = readdirSync(CONFIG.LOG_DIR).filter(f => f.startsWith("results_") && f.endsWith(".jsonl"));
  for (const f of files) {
    for (const line of readFileSync(join(CONFIG.LOG_DIR, f), "utf-8").trim().split("\n")) {
      try { const r = JSON.parse(line); if (r.status === "success") set.add(r.email); } catch (e) {}
    }
  }
  return set;
}

// ==================== 浏览器操作 ====================

async function signupAndWaitForLink(page, email, account) {
  // Step 1: 打开注册页
  log("[1/4] Opening ZO signup...");
  await page.goto("https://www.zo.computer/signup", { waitUntil: "networkidle2", timeout: 30000 });
  await sleep(3000);
  
  // Step 2: 点击 "Email me a sign-up link"
  log("[2/4] Clicking Email button...");
  const clicked = await page.evaluate(() => {
    const buttons = document.querySelectorAll("button");
    for (const btn of buttons) {
      const directText = Array.from(btn.childNodes).filter(n => n.nodeType === 3).map(n => n.textContent.trim()).join("");
      if (directText === "Email me a sign-up link") { btn.click(); return true; }
    }
    return false;
  });
  if (!clicked) throw new Error("Could not click Email button");
  await sleep(2000);
  
  // Step 3: 填写邮箱
  log("[3/4] Filling email: " + email);
  const fillResult = await page.evaluate((email) => {
    const input = document.getElementById("email") || document.querySelector("input[type=email]");
    if (!input) return "input not found";
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    setter.call(input, email);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    return "filled: " + input.value;
  }, email);
  log("Fill result: " + fillResult);
  await sleep(500);
  
  // Step 4: 点击 Continue
  log("[4/4] Clicking Continue...");
  const contResult = await page.evaluate(() => {
    const buttons = document.querySelectorAll("button");
    for (const btn of buttons) {
      if (btn.textContent.trim() === "Continue") { btn.click(); return "clicked"; }
    }
    return "not found";
  });
  if (contResult !== "clicked") throw new Error("Could not click Continue");
  await sleep(3000);
  
  // 确认页面显示成功消息
  const pageText = await page.evaluate(() => document.body?.innerText?.substring(0, 300) || "");
  if (!/check your email|login link/i.test(pageText)) {
    log("[WARN] Unexpected page: " + pageText.substring(0, 200));
  } else {
    log("[OK] Email sent successfully!");
  }
  
  // Step 5: 轮询等待魔法链接
  log("Waiting for magic link...");
  let currentRefreshToken = account.refreshToken;
  let magicLink = null;
  
  for (let attempt = 1; attempt <= CONFIG.POLL_MAX_ATTEMPTS; attempt++) {
    try {
      const tokenResult = await refreshToken(account.clientId, currentRefreshToken);
      currentRefreshToken = tokenResult.nextRefreshToken;
      
      const messages = await fetchLatestMessages(tokenResult.accessToken, 20);
      magicLink = extractMagicLink(messages);
      
      if (magicLink) {
        log("[OK] Magic link found (attempt " + attempt + ")");
        log("  From: " + magicLink.from + " | Subject: " + magicLink.subject);
        
        // 保存刷新后的 token
        if (currentRefreshToken !== account.refreshToken) {
          const filePath = join(CONFIG.EMAIL_DIR, account.file);
          const newContent = account.email + "----" + account.password + "----" + account.clientId + "----" + currentRefreshToken;
          writeFileSync(filePath, newContent, "utf-8");
          log("  Saved refreshed token");
        }
        
        return magicLink;
      }
      
      process.stdout.write(".");
      await sleep(CONFIG.POLL_INTERVAL_MS);
    } catch (err) {
      log("[WARN] Poll " + attempt + ": " + err.message);
      await sleep(CONFIG.POLL_INTERVAL_MS);
    }
  }
  
  throw new Error("Magic link not found after " + CONFIG.POLL_MAX_ATTEMPTS + " attempts");
}

async function completeRegistration(page, magicLink) {
  log("Opening magic link in browser...");
  
  // 用 location.href 跳转（避免 puppeteer 的 navigation 被拦截）
  await page.evaluate((url) => { location.href = url; }, magicLink.link);
  
  // 等待页面跳转
  await sleep(8000);
  
  const url = await page.evaluate(() => location.href);
  log("URL after navigation: " + url);
  
  // 截图
  if (!existsSync(CONFIG.LOG_DIR)) mkdirSync(CONFIG.LOG_DIR, { recursive: true });
  await page.screenshot({ path: join(CONFIG.LOG_DIR, "final_" + Date.now() + ".png"), fullPage: false });
  
  // 检查是否成功
  const bodyText = await page.evaluate(() => document.body?.innerText?.substring(0, 500) || "");
  
  const isDashboard = /\/dashboard|\/account|\/home|\/welcome|\/settings/i.test(url);
  const isError = /something went wrong|error|expired|invalid/i.test(bodyText);
  
  if (isDashboard) {
    log("[SUCCESS] Registration complete!");
    return "success";
  } else if (isError) {
    log("[WARN] Page shows error: " + bodyText.substring(0, 200));
    return "error";
  } else {
    log("[DONE] URL: " + url + " | Body: " + bodyText.substring(0, 200));
    return "unknown";
  }
}

// ==================== 主流程 ====================

async function processAccount(account, dryRun) {
  log("Processing: " + account.email);
  
  let browser;
  try {
    browser = await puppeteer.connect({ browserURL: "http://localhost:9222", timeout: 10000 });
    const pages = await browser.pages();
    const page = pages[0];
    await page.setViewport({ width: 1440, height: 900 });
    
    const magicLink = await signupAndWaitForLink(page, account.email, account);
    
    if (dryRun) {
      saveResult({ email: account.email, status: "dry_run" });
      browser.disconnect();
      return "dry_run";
    }
    
    const result = await completeRegistration(page, magicLink);
    
    if (result === "success") {
      saveResult({ email: account.email, status: "success", magicLink: magicLink.link });
    } else {
      saveResult({ email: account.email, status: result, magicLink: magicLink.link });
    }
    
    browser.disconnect();
    return result;
    
  } catch (err) {
    log("[ERROR] " + err.message);
    saveResult({ email: account.email, status: "error", error: err.message });
    if (browser) browser.disconnect();
    return "error";
  }
}

async function main() {
  const args = process.argv.slice(2);
  const countIdx = args.indexOf("--count");
  const maxCount = countIdx >= 0 ? parseInt(args[countIdx + 1]) : Infinity;
  const dryRun = args.includes("--dry-run");
  
  log("=== ZO Registration v4 ===");
  log("Mode: " + (dryRun ? "DRY RUN" : "FULL"));
  
  const accounts = loadAccounts();
  log("Loaded " + accounts.length + " accounts");
  if (accounts.length === 0) { log("[FAIL] No accounts"); process.exit(1); }
  
  const registered = loadRegistered();
  const pending = accounts.filter(a => !registered.has(a.email)).slice(0, maxCount);
  log("Already registered: " + registered.size + " | Pending: " + pending.length);
  if (pending.length === 0) { log("[OK] Nothing to do"); return; }
  
  let success = 0, failed = 0;
  for (let i = 0; i < pending.length; i++) {
    log("");
    log("[" + (i + 1) + "/" + pending.length + "] " + pending[i].email);
    const result = await processAccount(pending[i], dryRun);
    if (result === "success" || result === "dry_run") success++;
    else failed++;
    if (i < pending.length - 1) await sleep(2000);
  }
  
  log("");
  log("=== DONE ===");
  log("Success: " + success + " | Failed: " + failed);
}

main().catch(err => { console.error("Fatal:", err); process.exit(1); });
