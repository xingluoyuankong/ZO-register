/**
 * ZO Computer 一键注册脚本 v2
 * 
 * 改进：
 *  - 使用 /me/messages 而非 /inbox/messages（搜索所有文件夹）
 *  - 使用 .default scope（权限更广）
 *  - 获取邮件全文（body.content）而非预览
 *  - 增加多种链接匹配模式
 * 
 * 用法：
 *   node zo-register2.mjs                  # 注册所有未注册的邮箱
 *   node zo-register2.mjs --count 3        # 只注册前3个
 *   node zo-register2.mjs --dry-run        # 只发链接，不浏览器注册
 *   node zo-register2.mjs --link-only      # 只发链接并等待获取（不浏览器打开）
 */

import { readFileSync, readdirSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join, basename } from "path";

// ==================== 配置 ====================
const CONFIG = {
  EMAIL_DIR: "C:\\Users\\XZXyuan\\Downloads\\批量注册邮箱\\已经使用",
  ZO_BASE: "https://www.zo.computer",
  EMAIL_LOGIN_API: "https://www.zo.computer/api/email-login/request",
  GRAPH_TOKEN_URL: "https://login.microsoftonline.com/consumers/oauth2/v2.0/token",
  // 使用 .default scope，和 token-mail-app 一致
  GRAPH_SCOPES: "https://graph.microsoft.com/.default offline_access",
  // 使用 /me/messages 而非 /me/mailFolders/inbox/messages
  GRAPH_MESSAGES_API: "https://graph.microsoft.com/v1.0/me/messages",
  POLL_INTERVAL_MS: 5000,
  POLL_MAX_ATTEMPTS: 30,
  LOG_DIR: "E:\\API获取工具\\ZO注册\\logs",
  CHROME_DEBUG_PORT: 9222,
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

/**
 * 获取邮件 - 使用 /me/messages 搜索所有文件夹，获取全文
 */
async function fetchMessages(accessToken, top) {
  top = top || 10;
  // 获取邮件全文（body.content），包括 HTML 和 text
  const url = CONFIG.GRAPH_MESSAGES_API + 
    "?$top=" + top + 
    "&$select=id,subject,from,body,bodyPreview,receivedDateTime,parentFolderId" +
    "&$orderby=receivedDateTime%20desc";

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

/**
 * 从邮件全文中提取 ZO 登录链接
 */
function extractMagicLink(messages) {
  // 链接匹配模式
  const linkPatterns = [
    // ZO 相关的所有链接
    /https?:\/\/[^\s"'<>\]]*zo\.computer[^\s"'<>\]]*/gi,
    /https?:\/\/[^\s"'<>\]]*zocomputer[^\s"'<>\]]*/gi,
    // cello.so 短链（ZO 的域名）
    /https?:\/\/[^\s"'<>\]]*cello\.so[^\s"'<>\]]*/gi,
    // 任何包含 login/signup/auth/verify/token 的链接
    /https?:\/\/[^\s"'<>\]]*(?:login|signup|auth|verify|token|magic|confirm)[^\s"'<>\]]*/gi,
  ];

  const excludePatterns = [
    /\.(png|jpg|jpeg|gif|css|js|svg|ico|woff|ttf|eot|mp4|webp)/i,
    /\/pricing/i, /\/models/i, /\/mission/i, /\/blog/i, 
    /\/team/i, /\/tutorials/i, /\/api\//i,
    /fonts\//i, /images\//i, /assets\//i,
    /sentry\.io/i, /analytics\.io/i, /googleapis\.com/i,
    /facebook\.com/i, /twitter\.com/i,
  ];

  for (const msg of messages) {
    const subject = msg.subject || "";
    // 获取邮件全文
    const body = msg.body || {};
    const htmlBody = (body.contentType === "html" && body.content) || "";
    const textBody = (body.contentType === "text" && body.content) || "";
    const preview = msg.bodyPreview || "";
    
    const combined = subject + " " + preview + " " + textBody + " " + htmlBody;

    for (const pattern of linkPatterns) {
      const matches = combined.match(pattern);
      if (matches) {
        for (let link of matches) {
          // 清理链接末尾的标点
          link = link.replace(/[)\]>,;:.!?]+$/, "").replace(/&amp;/g, "&");
          
          // 排除静态资源和无关链接
          let excluded = false;
          for (const ep of excludePatterns) {
            if (ep.test(link)) { excluded = true; break; }
          }
          if (excluded) continue;
          
          // 排除 ZO 首页本身
          if (link.match(/^https?:\/\/(?:www\.)?zo\.computer\/?$/i)) continue;
          
          return { 
            link: link, 
            subject: subject, 
            receivedAt: msg.receivedDateTime,
            from: msg.from ? (msg.from.emailAddress?.name || msg.from.emailAddress?.address) : "?"
          };
        }
      }
    }
  }
  return null;
}

// ==================== ZO API ====================

async function requestEmailLogin(email) {
  // 使用 token-mail-app 的方式：从浏览器页面获取当前 URL 的 pathname + search
  const redirect = "/signup?productId=www.zo.computer&ucc=MptyFaIB9Xx";
  
  const resp = await fetch(CONFIG.EMAIL_LOGIN_API, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: email,
      desktop: false,
      redirect: redirect,
    }),
  });

  return { ok: resp.ok, status: resp.status, text: await resp.text().catch(() => "") };
}

// ==================== 浏览器自动化 ====================

async function openMagicLink(magicLink) {
  let browser;
  try {
    const puppeteerPath = "E:\\API获取工具\\ZO注册\\node_modules\\puppeteer-core";
    const puppeteer = require(puppeteerPath);
    
    browser = await puppeteer.connect({
      browserURL: "http://localhost:" + CONFIG.CHROME_DEBUG_PORT,
      timeout: 5000,
    });

    // 创建新标签页（无痕）
    const context = await browser.createIncognitoBrowserContext();
    const page = await context.newPage();
    await page.setViewport({ width: 1440, height: 900 });

    log("Opening magic link: " + magicLink.substring(0, 80) + "...");
    await page.goto(magicLink, { waitUntil: "domcontentloaded", timeout: 30000 });
    await sleep(3000);

    const currentUrl = page.url();
    log("Current URL: " + currentUrl);

    // 截图
    if (!existsSync(CONFIG.LOG_DIR)) mkdirSync(CONFIG.LOG_DIR, { recursive: true });
    const screenshotPath = join(CONFIG.LOG_DIR, "register_" + Date.now() + ".png");
    await page.screenshot({ path: screenshotPath, fullPage: false });
    log("Screenshot: " + screenshotPath);

    // 等待页面跳转
    await sleep(5000);
    const laterUrl = page.url();
    if (laterUrl !== currentUrl) {
      log("URL changed: " + laterUrl);
      await page.screenshot({ path: join(CONFIG.LOG_DIR, "after_" + Date.now() + ".png"), fullPage: false });
    }

    // 获取页面标题
    const title = await page.title();
    log("Page title: " + title);

    // 检查是否注册成功（URL 包含 dashboard/account/home/welcome）
    const isSuccess = /\/dashboard|\/account|\/home|\/welcome|\/settings/i.test(laterUrl);
    
    if (isSuccess) {
      log("[OK] Registration appears successful!");
      await page.screenshot({ path: join(CONFIG.LOG_DIR, "success_" + Date.now() + ".png"), fullPage: true });
    } else {
      log("[INFO] Check screenshot. Final URL: " + laterUrl);
    }

    await context.close();
    return { success: isSuccess, url: laterUrl, title };
  } catch (err) {
    log("[ERROR] Browser: " + err.message);
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
  log("  [OK] Login link sent (HTTP " + sendResult.status + ")");

  if (dryRun) {
    saveResult({ email: account.email, status: "dry_run" });
    return "dry_run";
  }

  // 2. 等待魔法链接
  log("  Waiting for magic link email...");
  let currentRefreshToken = account.refreshToken;
  let magicLink = null;

  for (let attempt = 1; attempt <= CONFIG.POLL_MAX_ATTEMPTS; attempt++) {
    try {
      const tokenResult = await refreshAccessToken(account.clientId, currentRefreshToken);
      currentRefreshToken = tokenResult.nextRefreshToken;

      // 获取邮件全文
      const messages = await fetchMessages(tokenResult.accessToken, 15);
      magicLink = extractMagicLink(messages);

      if (magicLink) {
        log("  [OK] Magic link found (attempt " + attempt + ")");
        log("    From: " + magicLink.from);
        log("    Subject: " + magicLink.subject);
        log("    Link: " + magicLink.link.substring(0, 100) + "...");
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
    log("  === MAGIC LINK ===");
    log("  " + magicLink.link);
    log("  ==================");
    return "link_found";
  }

  // 3. 用浏览器打开魔法链接
  log("  Opening in browser...");
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

  log("=== ZO Computer Registration v2 ===");
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
