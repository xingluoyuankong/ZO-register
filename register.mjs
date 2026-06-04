/**
 * ZO Computer 批量注册脚本
 * 
 * 流程：
 * 1. 读取 Outlook 邮箱凭证（email----password----clientId----refreshToken）
 * 2. POST /api/email-login/request 发送登录魔法链接
 * 3. 通过 Microsoft Graph API 获取收件箱中的魔法链接
 * 4. 输出魔法链接供浏览器脚本打开
 * 
 * 用法：node register.mjs [--count N] [--dry-run]
 */

import { readFileSync, readdirSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join, basename } from "path";

// ==================== 配置 ====================
const CONFIG = {
  EMAIL_DIR: "C:\\Users\\XZXyuan\\Downloads\\批量注册邮箱\\已经使用",
  SIGNUP_URL: "https://zo-computer.cello.so/MptyFaIB9Xx",
  ZO_BASE: "https://www.zo.computer",
  EMAIL_LOGIN_API: "https://www.zo.computer/api/email-login/request",
  GRAPH_TOKEN_URL: "https://login.microsoftonline.com/consumers/oauth2/v2.0/token",
  GRAPH_API_BASE: "https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages",
  GRAPH_SCOPES: "offline_access https://graph.microsoft.com/Mail.Read https://graph.microsoft.com/User.Read",
  POLL_INTERVAL_MS: 5000,
  POLL_MAX_ATTEMPTS: 24,
  LOG_DIR: "E:\\API获取工具\\ZO注册\\logs",
};

// ==================== 工具函数 ====================

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
    .filter(function(f) { return f.endsWith(".txt"); })
    .filter(function(f) { return !f.startsWith("tokens_"); })
    .filter(function(f) { return !f.startsWith("merged_"); })
    .filter(function(f) { return !f.startsWith("probe"); })
    .filter(function(f) { return !f.startsWith("merge_"); })
    .filter(function(f) { return !f.includes("combo"); });
  
  var accounts = [];
  for (var i = 0; i < files.length; i++) {
    var filePath = join(CONFIG.EMAIL_DIR, files[i]);
    var account = parseEmailFile(filePath);
    if (account && account.email && account.refreshToken) {
      accounts.push(account);
    }
  }
  return accounts;
}

async function refreshAccessToken(clientId, refreshToken) {
  var body = new URLSearchParams({
    client_id: clientId,
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    scope: CONFIG.GRAPH_SCOPES,
  });

  var resp = await fetch(CONFIG.GRAPH_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!resp.ok) {
    var text = await resp.text();
    throw new Error("Token refresh failed (" + resp.status + "): " + text);
  }

  var data = await resp.json();
  if (!data.access_token) {
    throw new Error("Token response missing access_token");
  }

  return {
    accessToken: data.access_token,
    nextRefreshToken: data.refresh_token || refreshToken,
  };
}

async function fetchInboxMessages(accessToken, top) {
  top = top || 5;
  var url = CONFIG.GRAPH_API_BASE + "?$top=" + top + "&$select=id,subject,from,bodyPreview,body,receivedDateTime&$orderby=receivedDateTime%20desc";
  
  var resp = await fetch(url, {
    headers: {
      Accept: "application/json",
      Authorization: "Bearer " + accessToken,
    },
  });

  if (!resp.ok) {
    var text = await resp.text();
    throw new Error("Graph API failed (" + resp.status + "): " + text);
  }

  var data = await resp.json();
  return data.value || [];
}

function extractLoginLink(messages) {
  for (var i = 0; i < messages.length; i++) {
    var msg = messages[i];
    var bodyContent = (msg.body && msg.body.content) || "";
    var preview = msg.bodyPreview || "";
    var subject = msg.subject || "";
    var combined = subject + " " + preview + " " + bodyContent;
    
    // 匹配 zo.computer 的登录/验证链接
    var linkPatterns = [
      /https?:\/\/[^\s"<>]*zo\.computer[^\s"<>]*login[^\s"<>]*/gi,
      /https?:\/\/[^\s"<>]*zo\.computer[^\s"<>]*auth[^\s"<>]*/gi,
      /https?:\/\/[^\s"<>]*zo\.computer[^\s"<>]*verify[^\s"<>]*/gi,
      /https?:\/\/[^\s"<>]*zo\.computer[^\s"<>]*token[^\s"<>]*/gi,
      /https?:\/\/[^\s"<>]*zo\.computer[^\s"<>]*magic[^\s"<>]*/gi,
      /https?:\/\/[^\s"<>]*zo\.computer[^\s"<>]*code[^\s"<>]*/gi,
      /https?:\/\/[^\s"<>]*zo\.computer[^\s"<>]*callback[^\s"<>]*/gi,
    ];

    for (var j = 0; j < linkPatterns.length; j++) {
      var matches = combined.match(linkPatterns[j]);
      if (matches && matches.length > 0) {
        var link = matches[0].replace(/&amp;/g, "&");
        return { link: link, subject: subject, receivedAt: msg.receivedDateTime };
      }
    }

    // 通用匹配：任何包含 zo.computer 的链接
    var allLinks = combined.match(/https?:\/\/[^\s"<>]*zo\.computer[^\s"<>)\]]+/gi) || [];
    for (var k = 0; k < allLinks.length; k++) {
      var link2 = allLinks[k].replace(/&amp;/g, "&");
      // 排除静态资源和首页
      if (!link2.match(/\.(png|jpg|css|js|svg|ico|woff)/i) && 
          !link2.match(/\/\/www\.zo\.computer\/?$/) &&
          !link2.match(/\/pricing/) && !link2.match(/\/models/) && 
          !link2.match(/\/mission/) && !link2.match(/\/blog/) && 
          !link2.match(/\/team/) && !link2.match(/\/tutorials/)) {
        return { link: link2, subject: subject, receivedAt: msg.receivedDateTime };
      }
    }
  }
  return null;
}

async function requestEmailLogin(email, signupUrl) {
  var urlObj = new URL(signupUrl);
  var redirectPath = urlObj.pathname + urlObj.search;
  
  var resp = await fetch(CONFIG.EMAIL_LOGIN_API, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: email,
      redirect: redirectPath,
    }),
  });

  return {
    ok: resp.ok,
    status: resp.status,
    text: await resp.text().catch(function() { return ""; }),
  };
}

async function waitForMagicLink(clientId, refreshToken, email) {
  log("  Waiting for magic link email...");
  
  var currentRefreshToken = refreshToken;
  
  for (var attempt = 1; attempt <= CONFIG.POLL_MAX_ATTEMPTS; attempt++) {
    try {
      var tokenResult = await refreshAccessToken(clientId, currentRefreshToken);
      currentRefreshToken = tokenResult.nextRefreshToken;
      
      var messages = await fetchInboxMessages(tokenResult.accessToken, 10);
      var result = extractLoginLink(messages);
      
      if (result) {
        log("  [OK] Magic link found (attempt " + attempt + "): " + result.subject);
        return { link: result.link, subject: result.subject, receivedAt: result.receivedAt, refreshToken: currentRefreshToken };
      }
      
      if (attempt < CONFIG.POLL_MAX_ATTEMPTS) {
        await sleep(CONFIG.POLL_INTERVAL_MS);
      }
    } catch (err) {
      log("  [WARN] Poll failed (attempt " + attempt + "): " + err.message);
      if (attempt < CONFIG.POLL_MAX_ATTEMPTS) {
        await sleep(CONFIG.POLL_INTERVAL_MS);
      }
    }
  }
  
  return null;
}

function saveResult(result) {
  if (!existsSync(CONFIG.LOG_DIR)) {
    mkdirSync(CONFIG.LOG_DIR, { recursive: true });
  }
  
  var logFile = join(CONFIG.LOG_DIR, "results_" + new Date().toISOString().slice(0, 10) + ".jsonl");
  var line = JSON.stringify(Object.assign({}, result, { timestamp: new Date().toISOString() })) + "\n";
  writeFileSync(logFile, line, { flag: "a" });
}

function loadRegisteredEmails() {
  var registered = new Set();
  var logFile = join(CONFIG.LOG_DIR, "results_" + new Date().toISOString().slice(0, 10) + ".jsonl");
  if (existsSync(logFile)) {
    var lines = readFileSync(logFile, "utf-8").trim().split("\n");
    for (var i = 0; i < lines.length; i++) {
      try {
        var r = JSON.parse(lines[i]);
        if (r.status === "success" || r.status === "link_found") {
          registered.add(r.email);
        }
      } catch (e) {}
    }
  }
  return registered;
}

// ==================== 主流程 ====================

async function main() {
  var args = process.argv.slice(2);
  var countIdx = args.indexOf("--count");
  var maxCount = countIdx >= 0 ? parseInt(args[countIdx + 1]) : Infinity;
  var dryRun = args.includes("--dry-run");
  
  log("=== ZO Computer Batch Registration ===");
  log("Mode: " + (dryRun ? "DRY RUN" : "LIVE"));
  
  // 1. Load email accounts
  var accounts = loadEmailAccounts();
  log("Loaded " + accounts.length + " email accounts");
  
  if (accounts.length === 0) {
    log("[FAIL] No email accounts found");
    process.exit(1);
  }
  
  var toProcess = accounts.slice(0, maxCount);
  log("Processing: " + toProcess.length + " accounts");
  
  // 2. Check already registered
  var registered = loadRegisteredEmails();
  var pending = toProcess.filter(function(a) { return !registered.has(a.email); });
  log("Already registered: " + registered.size + " | Pending: " + pending.length);
  
  if (dryRun) {
    log("DRY RUN - listing accounts:");
    for (var d = 0; d < pending.length; d++) {
      log("  [DRY] " + pending[d].email);
    }
    return;
  }
  
  // 3. Process each account
  var successCount = 0;
  var failCount = 0;
  
  for (var i = 0; i < pending.length; i++) {
    var account = pending[i];
    log("");
    log("[" + (i + 1) + "/" + pending.length + "] Processing: " + account.email);
    
    try {
      // 3a. Send magic link
      log("  Sending login link...");
      var sendResult = await requestEmailLogin(account.email, CONFIG.SIGNUP_URL);
      
      if (!sendResult.ok) {
        log("  [FAIL] Send failed: HTTP " + sendResult.status);
        saveResult({ email: account.email, status: "send_failed", error: "HTTP " + sendResult.status });
        failCount++;
        continue;
      }
      
      log("  [OK] Login link sent");
      
      // 3b. Wait for magic link
      var magicLink = await waitForMagicLink(account.clientId, account.refreshToken, account.email);
      
      if (!magicLink) {
        log("  [FAIL] Magic link not found in inbox");
        saveResult({ email: account.email, status: "no_link", error: "Magic link not found" });
        failCount++;
        continue;
      }
      
      log("  [LINK] " + magicLink.link.substring(0, 100) + "...");
      
      // 3c. Save result
      saveResult({
        email: account.email,
        status: "link_found",
        magicLink: magicLink.link,
        subject: magicLink.subject,
        receivedAt: magicLink.receivedAt,
      });
      
      successCount++;
      
      // Print link for manual use or browser script
      log("");
      log("  === MAGIC LINK ===");
      log("  " + magicLink.link);
      log("  ==================");
      log("");
      
      // Rate limit
      if (i < pending.length - 1) {
        await sleep(2000);
      }
      
    } catch (err) {
      log("  [FAIL] Error: " + err.message);
      saveResult({ email: account.email, status: "error", error: err.message });
      failCount++;
    }
  }
  
  // 4. Summary
  log("");
  log("=== DONE ===");
  log("Success: " + successCount + " | Failed: " + failCount + " | Total: " + pending.length);
  log("Results: " + join(CONFIG.LOG_DIR, "results_" + new Date().toISOString().slice(0, 10) + ".jsonl"));
}

main().catch(function(err) {
  console.error("Fatal error:", err);
  process.exit(1);
});
