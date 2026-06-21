/**
 * batch_cookie_at.js — 批量注册 ZO 账号 + 获取 Cookie Access Token
 * 
 * ⚠️ 这个脚本获取的是 api.zo.computer 的 access_token Cookie（JWT eyJ...开头）
 *    不是 Settings 页面的 API Key（zo_sk_xxx）
 * 
 * 用法:
 *   node batch_cookie_at.js single          # 单线程测试（跳过已有 cookie AT 的）
 *   node batch_cookie_at.js parallel [N]    # N 并发（默认 4）
 */

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const { registerOne } = require("./zo_register");

// ===== Config =====
const ZO_FILE = path.join("C:\\Users\\XZXyuan\\Downloads", "100个Outlook邮箱.txt");
const REGISTERED_DIR = path.join(__dirname, "..", "registered");
const COOKIE_AT_DIR = path.join(REGISTERED_DIR, "Cookie ATs");
const RESULTS_FILE = path.join(REGISTERED_DIR, "cookie_at_results.jsonl");
const MAX_BROWSERS = 3;  // ★ 降低到 3 减少资源占用
const MAX_RETRIES = 2;

// ★ 进程监控（每 60 秒检查 Edge 进程数）
let processMonitorInterval = null;
function startProcessMonitor() {
  if (processMonitorInterval) return;
  processMonitorInterval = setInterval(() => {
    try {
      const { execSync } = require("child_process");
      const output = execSync("tasklist /FI \"IMAGENAME eq msedge.exe\" /NH", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
      const count = (output.match(/msedge\.exe/gi) || []).length;
      if (count > 50) {
        console.log(`\n⚠️ Edge 进程过多 (${count})，清理孤立进程...`);
        try { execSync("taskkill /F /IM msedge.exe 2>nul", { stdio: "ignore" }); } catch(e) {}
      } else {
        console.log(`[监控] Edge 进程数: ${count}`);
      }
    } catch(e) {}
  }, 60000);
}
function stopProcessMonitor() {
  if (processMonitorInterval) {
    clearInterval(processMonitorInterval);
    processMonitorInterval = null;
  }
}

// ===== Pre-flight cleanup =====
function preflightCleanup() {
  try { execSync("taskkill /F /IM msedge.exe 2>nul", { stdio: "ignore" }); } catch(e) {}
  try { execSync("taskkill /F /IM chrome.exe 2>nul", { stdio: "ignore" }); } catch(e) {}
  const tmpBase = "E:\\Openclaw\\tmp";
  if (fs.existsSync(tmpBase)) {
    const dirs = fs.readdirSync(tmpBase).filter(d => d.startsWith("zo_reg_"));
    for (const d of dirs) {
      try { fs.rmSync(path.join(tmpBase, d), { recursive: true, force: true }); } catch(e) {}
    }
    if (dirs.length > 0) console.log(`Cleaned ${dirs.length} orphaned temp dirs`);
  }
}

// ===== Browser concurrency control =====
let activeBrowsers = 0;
const browserQueue = [];

async function acquireBrowserSlot() {
  if (activeBrowsers < MAX_BROWSERS) { activeBrowsers++; return; }
  return new Promise(resolve => browserQueue.push(resolve));
}

function releaseBrowserSlot() {
  activeBrowsers--;
  if (browserQueue.length > 0) {
    activeBrowsers++;
    browserQueue.shift()();
  }
}

// ===== Parse accounts (use regex to handle variable-length delimiters) =====
function parseAccounts(filePath) {
  const lines = fs.readFileSync(filePath, "utf8").split("\n").filter(l => l.trim());
  const seen = new Set();
  const accounts = [];
  for (const line of lines) {
    // Use regex to split on 3+ consecutive dashes (handles both ---- and -----)
    const parts = line.split(/-{3,}/);
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

// ===== Check existing cookie ATs =====
function getExistingCookieATs() {
  if (!fs.existsSync(COOKIE_AT_DIR)) return new Set();
  return new Set(
    fs.readdirSync(COOKIE_AT_DIR)
      .filter(f => f.endsWith(".txt"))
      .map(f => f.replace(".txt", ""))
  );
}

// ===== Worker: register + capture cookie AT =====
async function worker(account, index, total) {
  await acquireBrowserSlot();
  let capturedCookie = null;

  try {
    const log = (msg) => console.log(`[${index}/${total}] ${msg}`);

    // Set up cookie capture hook
    global.__zoCookieCallback = (cookie) => {
      capturedCookie = cookie;
    };

    const config = {
      registeredDir: REGISTERED_DIR,
      accessTokenDir: COOKIE_AT_DIR,  // Save to Cookie ATs dir (registerOne will skip API key if fetchToken=false)
      fetchToken: false,               // Don't fetch API key, we only need cookie AT
      browserType: "edge",
    };

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        log(`Starting... (attempt ${attempt})`);
        const t0 = Date.now();
        const result = await registerOne(account, config, log);
        const secs = ((Date.now() - t0) / 1000).toFixed(0);

        // Check if we captured the cookie AT (from callback OR from result)
        if (!capturedCookie && result.cookieAT) {
          capturedCookie = result.cookieAT;
        }
        
        if (capturedCookie && capturedCookie.value) {
          log(`✅ SUCCESS in ${secs}s | handle=${result.handle} | Cookie AT: ${capturedCookie.value.substring(0, 30)}...`);

          // Save cookie AT
          if (!fs.existsSync(COOKIE_AT_DIR)) fs.mkdirSync(COOKIE_AT_DIR, { recursive: true });
          const cookieFile = path.join(COOKIE_AT_DIR, account.email + ".txt");
          fs.writeFileSync(cookieFile, [
            "email: " + account.email,
            "handle: " + result.handle,
            "zoAddress: " + result.zoAddress,
            "cookieAT: " + capturedCookie.value,
            "domain: " + capturedCookie.domain,
            "expires: " + new Date(capturedCookie.expires * 1000).toISOString(),
            "time: " + new Date().toISOString(),
          ].join("\n"), "utf-8");
          log(`[COOKIE] Saved to: ${cookieFile}`);

          // Save to results log
          fs.appendFileSync(RESULTS_FILE, JSON.stringify({
            email: account.email,
            status: "success",
            handle: result.handle,
            zoAddress: result.zoAddress,
            cookieAT: capturedCookie.value,
            domain: capturedCookie.domain,
            expires: capturedCookie.expires,
            time: new Date().toISOString(),
            attempt,
            secs: parseInt(secs),
          }) + "\n", "utf8");

          return { email: account.email, status: "success", handle: result.handle, cookieAT: capturedCookie.value };
        } else {
          // Cookie not captured — might be because the account was already registered
          // or the cookie wasn't set yet
          log(`⚠️ Registration done but cookie AT not captured (attempt ${attempt})`);
          
          if (attempt < MAX_RETRIES) {
            log(`Retrying in 5s...`);
            await new Promise(r => setTimeout(r, 5000));
          } else {
            fs.appendFileSync(RESULTS_FILE, JSON.stringify({
              email: account.email,
              status: "fail",
              reason: "Cookie AT not captured after all attempts",
              handle: result?.handle || null,
              time: new Date().toISOString(),
              attempt,
            }) + "\n", "utf8");
            return { email: account.email, status: "fail", reason: "Cookie AT not captured" };
          }
        }
      } catch (err) {
        log(`❌ Attempt ${attempt} failed: ${err.message}`);
        if (attempt < MAX_RETRIES) {
          log(`Retrying in 5s...`);
          await new Promise(r => setTimeout(r, 5000));
        } else {
          fs.appendFileSync(RESULTS_FILE, JSON.stringify({
            email: account.email,
            status: "fail",
            reason: err.message,
            time: new Date().toISOString(),
            attempt,
          }) + "\n", "utf8");
          return { email: account.email, status: "fail", reason: err.message };
        }
      }
    }
  } finally {
    global.__zoCookieCallback = null;
    releaseBrowserSlot();
  }
}

// ===== Main =====
async function main() {
  const mode = process.argv[2];

  // Ensure directories
  if (!fs.existsSync(REGISTERED_DIR)) fs.mkdirSync(REGISTERED_DIR, { recursive: true });
  if (!fs.existsSync(COOKIE_AT_DIR)) fs.mkdirSync(COOKIE_AT_DIR, { recursive: true });

  preflightCleanup();

  const allAccounts = parseAccounts(ZO_FILE);
  console.log(`Loaded ${allAccounts.length} unique accounts from ${ZO_FILE}`);

  const existingCookieATs = getExistingCookieATs();
  console.log(`Existing Cookie ATs: ${existingCookieATs.size}`);

  // Filter out accounts that already have cookie AT
  const todo = allAccounts.filter(a => !existingCookieATs.has(a.email));
  console.log(`Accounts to process: ${todo.length} (skipping ${allAccounts.length - todo.length} with existing Cookie AT)\n`);

  if (todo.length === 0) {
    console.log("Nothing to do! All accounts already have Cookie ATs.");
    return;
  }

  if (mode === "single") {
    // Single mode: test first account
    console.log("=== Single Test Mode ===\n");
    startProcessMonitor();
    const result = await worker(todo[0], 1, todo.length);
    console.log("\nResult:", JSON.stringify(result, null, 2));

    if (result.status === "success") {
      console.log("\n✅ Cookie AT retrieved successfully!");
      console.log("Value (first 50 chars):", result.cookieAT?.substring(0, 50) + "...");
    }
  } else if (mode === "parallel") {
    const concurrency = Math.min(parseInt(process.argv[3]) || MAX_BROWSERS, MAX_BROWSERS);
    console.log(`=== Parallel Mode (${concurrency} concurrent) ===\n`);
    startProcessMonitor();

    const results = [];
    const promises = [];
    let idx = 0;

    for (let i = 0; i < Math.min(concurrency, todo.length); i++) {
      promises.push(
        worker(todo[idx], idx + 1, todo.length).then(r => {
          results.push(r);
          return (function chainNext() {
            idx++;
            if (idx < todo.length) {
              return worker(todo[idx], idx + 1, todo.length).then(r => {
                results.push(r);
                return chainNext();
              });
            }
          })();
        })
      );
    }

    await Promise.all(promises);

    // Summary
    const success = results.filter(r => r.status === "success").length;
    const fail = results.filter(r => r.status === "fail").length;
    console.log(`\n${"=".repeat(50)}`);
    console.log(`=== FINAL SUMMARY ===`);
    console.log(`Total: ${todo.length} | Success: ${success} | Failed: ${fail}`);
    console.log(`Success rate: ${(success / todo.length * 100).toFixed(1)}%`);
    console.log(`${"=".repeat(50)}`);

    if (fail > 0) {
      console.log(`\nFailed accounts:`);
      results.filter(r => r.status === "fail").forEach(r => {
        console.log(`  ${r.email}: ${r.reason}`);
      });
    }
  } else {
    console.log("Usage:");
    console.log("  node batch_cookie_at.js single           # Test 1 account");
    console.log("  node batch_cookie_at.js parallel [N]     # N concurrent (max 4)");
  }

  // Final cleanup
  stopProcessMonitor();
  try { execSync("taskkill /F /IM msedge.exe 2>nul", { stdio: "ignore" }); } catch(e) {}
}

main().catch(e => {
  console.error("Fatal:", e);
  process.exit(1);
});
