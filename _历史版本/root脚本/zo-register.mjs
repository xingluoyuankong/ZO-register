/**
 * ZO Computer 一键注册脚本
 * 流程：
 *   1. 读取邮箱凭证
 *   2. POST /api/email-login/request 发送魔法链接
 *   3. 轮询 Outlook 收件箱获取魔法链接
 *   4. 用浏览器打开魔法链接完成注册
 * 
 * 用法：
 *   node zo-register.mjs                  # 注册所有未注册的邮箱
 *   node zo-register.mjs --count 3        # 只注册前3个
 *   node zo-register.mjs --dry-run        # 只发链接，不浏览器注册
 *   node zo-register.mjs --link-only      # 只发链接并等待获取（不浏览器打开）
 */

import { readFileSync, readdirSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join, basename } from "path";

// ==================== 配置 ====================
const CONFIG = {
  EMAIL_DIR: "C:\\Users\\XZXyuan\\Downloads\\批量注册邮箱\\已经使用",
  ZO_BASE: "https://www.zo.computer",
  EMAIL_LOGIN_API: "https://www.zo.computer/api/email-login/request",
  GRAPH_TOKEN_URL: "https://login.microsoftonline.com/consumers/oauth2/v2.0/token",
  GRAPH_SCOPES: "offline_access https://graph.microsoft.com/Mail.Read https://graph.microsoft.com/User.Read",
  GRAPH_API_BASE: "https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages",
  POLL_INTERVAL_MS: 5000,
  POLL_MAX_ATTEMPTS: 24,
  LOG_DIR: "E:\\API获取工具\\ZO注册\\logs",
  CHROME_DEBUG_PORT: 9222,
  SIGNUP_REDIRECT: "/signup?productId=pro",
};

// ==================== 工具 ====================

function log(msg) {
  const ts = new Date().toISOString().replace("T", " ").replace("Z", "");
  console.log("[" + ts + "] " + msg);
}

function sleep(ms) {
  return new Promise(function(r) { setTimeout(r, ms); });
}

function parseEmailFile(filePath) {
  const content = readFileSync(filePath, "utf-8").trim();
  const parts = content.split("----").map(function(s) { return s.trim(); });
  if (parts.length < 4) return null;
  return {
    email: parts[0],
    password: parts[1],
    clientId: parts[2],
    refreshToken: parts[3],
    file: basename(filePath),
  };
}

function loadEmailAccounts() {
  const files = readdirSync(CONFIG.EMAIL_DIR)
    .filter(f => f.endsWith(".txt"))
    .filter(f => !f.startsWith("tokens_"))
    .filter(f => !f.startsWith("merged_"))
    .filter(f => !f.startsWith("probe"))
    .filter(f => !f.startsWith("merge_"))
    .filter(f => !f.includes("combo"));
  
  const accounts = [];
  for (const file of files) {
    const account = parseEmailFile(join(CONFIG.EMAIL_DIR, file));
    if (account && account.email && account.refreshToken) {
      accounts.push(account);
    }
  }
  return accounts;
}

// ==================== Microsoft Graph API ====================

async function refreshAccessToken(clientId, refreshToken) {
  const body = new URLSearchParams({
    client_id: clientId,
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    scope: CONFIG.GRAPH_SCOPES,
  });

  const resp = await fetch(CONFIG.GRAPH_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error("Token refresh failed (" + resp.status + "): " + text);
  }

  const data = await resp.json();
  if (!data.access_token) throw new Error("No access_token in response");

  return { accessToken: data.access_token, nextRefreshToken: data.refresh_token || refreshToken };
}

async function fetchInboxMessages(accessToken, top) {
  top = top || 10;
  const url = CONFIG.GRAPH_API_BASE + "?$top=" + top + "&$select=id,subject,from,bodyPreview,body,receivedDateTime&$orderby=receivedDateTime%20desc";

  const resp = await fetch(url, {
    headers: { Accept: "application/json", Authorization: "Bearer " + accessToken },
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error("Graph API failed (" + resp.status + "): " + text);
  }

  const data = await resp.json();
  return data.value || [];
}

function extractLoginLink(email, messages) {
  const patterns = [
    /https?:\/\/[^\s"<>]*zo\.computer[^\s"<>]*/gi,
    /https?:\/\/[^\s"<>]*zocomputer[^\s"<>]*/gi,
    /https?:\/\/[^\s"<>]*cello\.so[^\s"<>]*/gi,
  ];

  for (const msg of messages) {
    const subject = msg.subject || "";
    const preview = msg.bodyPreview || "";
    const bodyContent = (msg.body && msg.body.content) || "";
    const combined = subject + " " + preview + " " + bodyContent;

    for (const pattern of patterns) {
      const matches = combined.match(pattern);
      if (matches) {
        for (const link of matches) {
          const clean = link.replace(/&amp;/g, "&").replace(/[)\]]+$/, "");
          // 排除静态资源
          if (!clean.match(/\.(png|jpg|css|js|svg|ico|woff|ttf|eot)/i) &&
              !clean.match(/\/pricing/) && !clean.match(/\/models/) &&
              !clean.match(/\/mission/) && !clean.match(/\/blog/)) {
            return { link: clean, subject, receivedAt: msg.receivedDateTime };
          }
        }
      }
    }
  }
  return null;
}

// ==================== ZO API ====================

async function requestEmailLogin(email) {
  const resp = await fetch(CONFIG.EMAIL_LOGIN_API, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: email,
      redirect: CONFIG.SIGNUP_REDIRECT,
    }),
  });

  return { ok: resp.ok, status: resp.status, text: await resp.text().catch(() => "") };
}

// ==================== 浏览器自动化 ====================

async function connectBrowser() {
  // 动态导入 puppeteer-core
  const puppeteer = await import('file:///E:/API获取工具/ZO注册/node_modules/puppeteer-core/lib/puppeteer/index.js').catch(() => null);
  
  if (!puppeteer) {
    // fallback: 用 http 模块直接连 CDP
    log("Puppeteer import failed, using raw CDP...");
    return connectViaCDP();
  }

  const browser = await puppeteer.connect({
    browserURL: "http://localhost:" + CONFIG.CHROME_DEBUG_PORT,
    timeout: 5000,
  });

  return { browser, page: null, close: () => browser.close() };
}

async function connectViaCDP() {
  // 手动连接 CDP
  const http = await import('http');

  return new Promise((resolve, reject) => {
    http.get("http://localhost:" + CONFIG.CHROME_DEBUG_PORT + "/json/version", (res) => {
      let data = "";
      res.on("data", chunk => data += chunk);
      res.on("end", () => {
        try {
          const info = JSON.parse(data);
          const wsUrl = info.webSocketDebuggerUrl;
          log("CDP available, ws: " + wsUrl);
          resolve({ wsUrl, browser: null, page: null });
        } catch (e) {
          reject(new Error("CDP version check failed"));
        }
      });
    }).on("error", reject);
  });
}

async function openMagicLink(magicLink) {
  // 用 puppeteer 连接 Chrome 打开魔法链接
  let browser;
  try {
    const puppeteerPath = "E:\\API获取工具\\ZO注册\\node_modules\\puppeteer-core";
    const puppeteer = require(puppeteerPath);
    
    browser = await puppeteer.connect({
      browserURL: "http://localhost:" + CONFIG.CHROME_DEBUG_PORT,
      timeout: 5000,
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900 });

    log("Opening magic link: " + magicLink.substring(0, 80) + "...");
    await page.goto(magicLink, { waitUntil: "domcontentloaded", timeout: 30000 });
    await sleep(3000);

    const currentUrl = page.url();
    log("Current URL after magic link: " + currentUrl);

    // 截图
    const screenshotPath = join(CONFIG.LOG_DIR, "register_" + Date.now() + ".png");
    if (!existsSync(CONFIG.LOG_DIR)) mkdirSync(CONFIG.LOG_DIR, { recursive: true });
    await page.screenshot({ path: screenshotPath, fullPage: true });
    log("Screenshot: " + screenshotPath);

    // 检查是否需要填写密码（首次注册设置密码）
    const needsPassword = await page.evaluate(() => {
      const inputs = document.querySelectorAll("input[type=password]");
      return inputs.length > 0;
    });

    if (needsPassword) {
      log("Password setup required!");
      // 这里可以自动填写密码，暂时截图让用户手动处理
      // TODO: 自动填写密码逻辑
    }

    // 检查是否注册成功
    const isSuccess = await page.evaluate(() => {
      const url = window.location.href;
      return url.includes("/dashboard") || url.includes("/account") || url.includes("/home") || url.includes("/welcome");
    });

    if (isSuccess) {
      log("[OK] Registration appears successful!");
      await page.screenshot({ path: join(CONFIG.LOG_DIR, "success_" + Date.now() + ".png"), fullPage: true });
    } else {
      log("[INFO] Page loaded, check screenshot. URL: " + currentUrl);
      // 再等几秒看看异步跳转
      await sleep(5000);
      const laterUrl = page.url();
      log("URL after 5s: " + laterUrl);
      await page.screenshot({ path: join(CONFIG.LOG_DIR, "afterwait_" + Date.now() + ".png"), fullPage: true });
    }

    await page.close();
    await browser.close();
    return { success: isSuccess || false, url: currentUrl };
  } catch (err) {
    log("[ERROR] Browser error: " + err.message);
    if (browser) await browser.close().catch(() => {});
    return { success: false, error: err.message };
  }
}

// ==================== 日志 ====================

function saveResult(result) {
  if (!existsSync(CONFIG.LOG_DIR)) mkdirSync(CONFIG.LOG_DIR, { recursive: true });
  const logFile = join(CONFIG.LOG_DIR, "results_" + new Date().toISOString().slice(0, 10) + ".jsonl");
  writeFileSync(logFile, JSON.stringify({ ...result, ts: new Date().toISOString() }) + "\n", { flag: "a" });
}

function loadRegisteredEmails() {
  const registered = new Set();
  const logFile = join(CONFIG.LOG_DIR, "results_" + new Date().toISOString().slice(0, 10) + ".jsonl");
  if (!existsSync(logFile)) return registered;
  const lines = readFileSync(logFile, "utf-8").trim().split("\n");
  for (const line of lines) {
    try {
      const r = JSON.parse(line);
      if (r.status === "success") registered.add(r.email);
    } catch (e) {}
  }
  return registered;
}

// ==================== 主流程 ====================

async function processAccount(account, dryRun, linkOnly) {
  log("Processing: " + account.email);

  // 1. 发送魔法链接
  log("  Sending login link...");
  const sendResult = await requestEmailLogin(account.email);
  if (!sendResult.ok) {
    log("  [FAIL] Send failed: HTTP " + sendResult.status + " " + sendResult.text);
    saveResult({ email: account.email, status: "send_failed", error: "HTTP " + sendResult.status });
    return "send_failed";
  }
  log("  [OK] Login link sent");

  if (dryRun) {
    saveResult({ email: account.email, status: "dry_run" });
    return "dry_run";
  }

  // 2. 等待魔法链接
  log("  Waiting for magic link...");
  let currentRefreshToken = account.refreshToken;
  let magicLink = null;

  for (let attempt = 1; attempt <= CONFIG.POLL_MAX_ATTEMPTS; attempt++) {
    try {
      const tokenResult = await refreshAccessToken(account.clientId, currentRefreshToken);
      currentRefreshToken = tokenResult.nextRefreshToken;

      const messages = await fetchInboxMessages(tokenResult.accessToken, 10);
      magicLink = extractLoginLink(account.email, messages);

      if (magicLink) {
        log("  [OK] Magic link found (attempt " + attempt + "): " + magicLink.subject);
        break;
      }

      if (attempt < CONFIG.POLL_MAX_ATTEMPTS) {
        process.stdout.write(".");
        await sleep(CONFIG.POLL_INTERVAL_MS);
      }
    } catch (err) {
      log("  [WARN] Poll attempt " + attempt + ": " + err.message);
      if (attempt < CONFIG.POLL_MAX_ATTEMPTS) await sleep(CONFIG.POLL_INTERVAL_MS);
    }
  }

  if (!magicLink) {
    log("  [FAIL] Magic link not found after " + CONFIG.POLL_MAX_ATTEMPTS + " attempts");
    saveResult({ email: account.email, status: "no_link" });
    return "no_link";
  }

  saveResult({ email: account.email, status: "link_found", magicLink: magicLink.link, subject: magicLink.subject });

  if (linkOnly) {
    log("  [LINK] " + magicLink.link);
    return "link_found";
  }

  // 3. 用浏览器打开魔法链接
  log("  Opening magic link in browser...");
  const result = await openMagicLink(magicLink.link);

  if (result.success) {
    saveResult({ email: account.email, status: "success", magicLink: magicLink.link });
    log("  [SUCCESS] " + account.email + " registered!");
    return "success";
  } else {
    saveResult({ email: account.email, status: "browser_done", magicLink: magicLink.link, url: result.url });
    log("  [DONE] Link opened, check screenshot. URL: " + result.url);
    return "browser_done";
  }
}

async function main() {
  const args = process.argv.slice(2);
  const countIdx = args.indexOf("--count");
  const maxCount = countIdx >= 0 ? parseInt(args[countIdx + 1]) : Infinity;
  const dryRun = args.includes("--dry-run");
  const linkOnly = args.includes("--link-only");

  log("=== ZO Computer Registration ===");
  log("Mode: " + (dryRun ? "DRY RUN" : linkOnly ? "LINK ONLY" : "FULL"));

  const accounts = loadEmailAccounts();
  log("Loaded " + accounts.length + " accounts");

  if (accounts.length === 0) { log("[FAIL] No accounts"); process.exit(1); }

  const registered = loadRegisteredEmails();
  const pending = accounts.filter(a => !registered.has(a.email)).slice(0, maxCount);
  log("Already registered: " + registered.size + " | Pending: " + pending.length);

  if (pending.length === 0) { log("[OK] Nothing to do"); return; }

  let success = 0, failed = 0;
  for (let i = 0; i < pending.length; i++) {
    log("");
    log("[" + (i + 1) + "/" + pending.length + "] " + pending[i].email);
    try {
      const result = await processAccount(pending[i], dryRun, linkOnly);
      if (result === "success" || result === "dry_run" || result === "link_found") success++;
      else failed++;
    } catch (err) {
      log("[ERROR] " + err.message);
      failed++;
    }
    if (i < pending.length - 1) await sleep(2000);
  }

  log("");
  log("=== DONE ===");
  log("Success: " + success + " | Failed: " + failed);
}

main().catch(err => { console.error("Fatal:", err); process.exit(1); });
