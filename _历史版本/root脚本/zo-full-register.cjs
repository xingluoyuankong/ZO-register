/**
 * ZO Computer 完整注册脚本 v3
 * 
 * 关键修复：每个邮箱用自己的 clientId + refreshToken 查收邮件
 * 
 * 流程：
 *   1. 读取邮箱凭证（email----password----clientId----refreshToken）
 *   2. 用浏览器打开 ZO 注册页，填写邮箱，点击 Continue
 *   3. 用该邮箱对应的 token 通过 Graph API 轮询获取魔法链接
 *   4. 在浏览器中打开魔法链接完成注册
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
  POLL_MAX_ATTEMPTS: 30,
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

async function fetchMessages(accessToken, top) {
  top = top || 15;
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
  const f = join(CONFIG.LOG_DIR, "results_" + new Date().toISOString().slice(0, 10) + ".jsonl");
  if (!existsSync(f)) return set;
  for (const line of readFileSync(f, "utf-8").trim().split("\n")) {
    try { const r = JSON.parse(line); if (r.status === "success") set.add(r.email); } catch (e) {}
  }
  return set;
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
    
    // Step 1: 打开注册页，填写邮箱
    log("[1/3] Opening signup page...");
    await page.goto("https://www.zo.computer/signup", { waitUntil: "networkidle2", timeout: 30000 });
    await sleep(3000);
    
    // 点击 "Email me a sign-up link"
    log("[2/3] Clicking Email button...");
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
    
    // 填写邮箱
    log("Filling email...");
    await page.evaluate((email) => {
      const input = document.getElementById("email") || document.querySelector("input[type=email]");
      if (!input) throw new Error("Email input not found");
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      setter.call(input, email);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    }, account.email);
    await sleep(500);
    
    // 点击 Continue
    const contResult = await page.evaluate(() => {
      const buttons = document.querySelectorAll("button");
      for (const btn of buttons) {
        if (btn.textContent.trim() === "Continue") { btn.click(); return "clicked"; }
      }
      return "not found";
    });
    if (contResult !== "clicked") throw new Error("Could not click Continue");
    await sleep(3000);
    
    log("[OK] Email sent! Page says: Check your email for a login link");
    
    if (dryRun) {
      saveResult({ email: account.email, status: "dry_run" });
      browser.disconnect();
      return "dry_run";
    }
    
    // Step 2: 用该邮箱自己的 token 查收邮件
    log("[3/3] Waiting for magic link...");
    let currentRefreshToken = account.refreshToken;
    let magicLink = null;
    
    for (let attempt = 1; attempt <= CONFIG.POLL_MAX_ATTEMPTS; attempt++) {
      try {
        const tokenResult = await refreshToken(account.clientId, currentRefreshToken);
        currentRefreshToken = tokenResult.nextRefreshToken;
        
        const messages = await fetchMessages(tokenResult.accessToken, 15);
        magicLink = extractMagicLink(messages);
        
        if (magicLink) {
          log("[OK] Magic link found (attempt " + attempt + ")");
          log("  From: " + magicLink.from + " | Subject: " + magicLink.subject);
          break;
        }
        
        process.stdout.write(".");
        await sleep(CONFIG.POLL_INTERVAL_MS);
      } catch (err) {
        log("[WARN] Poll " + attempt + ": " + err.message);
        await sleep(CONFIG.POLL_INTERVAL_MS);
      }
    }
    
    if (!magicLink) {
      log("[FAIL] Magic link not found");
      saveResult({ email: account.email, status: "no_link" });
      browser.disconnect();
      return "no_link";
    }
    
    saveResult({ email: account.email, status: "link_found", magicLink: magicLink.link });
    
    // Step 3: 在浏览器中打开魔法链接
    log("Opening magic link...");
    await page.goto(magicLink.link, { waitUntil: "domcontentloaded", timeout: 30000 });
    await sleep(3000);
    
    const url = page.url();
    log("URL: " + url);
    await page.screenshot({ path: join(CONFIG.LOG_DIR, "final_" + Date.now() + ".png"), fullPage: false });
    
    await sleep(5000);
    const laterUrl = page.url();
    log("URL after 5s: " + laterUrl);
    
    const isSuccess = /\/dashboard|\/account|\/home|\/welcome|\/settings/i.test(laterUrl);
    
    if (isSuccess) {
      saveResult({ email: account.email, status: "success", magicLink: magicLink.link });
      log("[SUCCESS] " + account.email + " registered!");
    } else {
      saveResult({ email: account.email, status: "browser_done", magicLink: magicLink.link, url: laterUrl });
      log("[DONE] Check screenshots. URL: " + laterUrl);
    }
    
    browser.disconnect();
    return isSuccess ? "success" : "browser_done";
    
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
  
  log("=== ZO Registration v3 ===");
  log("Mode: " + (dryRun ? "DRY RUN" : "FULL"));
  
  const accounts = loadAccounts();
  log("Loaded " + accounts.length + " accounts");
  if (accounts.length === 0) { log("[FAIL] No accounts"); process.exit(1); }
  
  // 打印每个邮箱的 clientId 和 token 前缀
  for (const a of accounts) {
    log("  " + a.email + " | clientId=" + a.clientId.substring(0, 8) + "... | token=" + a.refreshToken.substring(0, 10) + "...");
  }
  
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
