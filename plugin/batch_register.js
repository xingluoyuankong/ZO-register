/**
 * batch_register.js — 批量注册 ZO 账号 + 获取 Access Token
 * 
 * 用法:
 *   node batch_register.js single          # 单线程测试（跳过已有 AT 的）
 *   node batch_register.js parallel [N]    # N 并发（默认 4）
 */

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const { registerOne } = require("./zo_register");

// ===== Config =====
const ZO_FILE = path.join("C:\\Users\\XZXyuan\\Downloads", "100个Outlook邮箱.txt");
const REGISTERED_DIR = path.join(__dirname, "..", "registered");
const AT_DIR = path.join(REGISTERED_DIR, "Access Tokens");
const RESULTS_FILE = path.join(REGISTERED_DIR, "register_results.jsonl");
const MAX_BROWSERS = 4;
const MAX_RETRIES = 2;

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

// ===== Parse accounts =====
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

// ===== Check existing ATs =====
function getExistingATs() {
  if (!fs.existsSync(AT_DIR)) return new Set();
  return new Set(fs.readdirSync(AT_DIR).filter(f => f.endsWith(".txt")).map(f => f.replace(".txt", "")));
}

// ===== Worker =====
async function worker(account, index, total) {
  await acquireBrowserSlot();
  try {
    const log = (msg) => console.log(`[${index}/${total}] ${msg}`);
    const config = {
      registeredDir: REGISTERED_DIR,
      accessTokenDir: AT_DIR,
      fetchToken: true,
      browserType: "edge",
    };

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        log(`Starting... (attempt ${attempt})`);
        const t0 = Date.now();
        const result = await registerOne(account, config, log);
        const secs = ((Date.now() - t0) / 1000).toFixed(0);
        log(`✅ SUCCESS in ${secs}s | handle=${result.handle} | AT=${result.accessToken ? 'YES' : 'NO'}`);

        // Save result
        if (!fs.existsSync(REGISTERED_DIR)) fs.mkdirSync(REGISTERED_DIR, { recursive: true });
        fs.appendFileSync(RESULTS_FILE, JSON.stringify({
          email: account.email,
          status: "success",
          handle: result.handle,
          zoAddress: result.zoAddress,
          accessToken: result.accessToken || null,
          time: new Date().toISOString(),
          attempt,
        }) + "\n", "utf8");

        return { email: account.email, status: "success", ...result };
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
    releaseBrowserSlot();
  }
}

// ===== Main =====
async function main() {
  const mode = process.argv[2];

  // Ensure directories
  if (!fs.existsSync(REGISTERED_DIR)) fs.mkdirSync(REGISTERED_DIR, { recursive: true });
  if (!fs.existsSync(AT_DIR)) fs.mkdirSync(AT_DIR, { recursive: true });

  const allAccounts = parseAccounts(ZO_FILE);
  console.log(`Loaded ${allAccounts.length} accounts from ${ZO_FILE}`);

  const existingATs = getExistingATs();
  console.log(`Existing ATs: ${existingATs.size}`);

  // Filter out accounts that already have AT
  const todo = allAccounts.filter(a => !existingATs.has(a.email));
  console.log(`Accounts to register: ${todo.length} (skipping ${allAccounts.length - todo.length} with existing AT)\n`);

  if (todo.length === 0) {
    console.log("Nothing to do! All accounts already have ATs.");
    return;
  }

  if (mode === "single") {
    // Single mode: test first account
    console.log("=== Single Test Mode ===\n");
    const result = await worker(todo[0], 1, todo.length);
    console.log("\nResult:", JSON.stringify(result, null, 2));
  } else if (mode === "parallel") {
    const concurrency = Math.min(parseInt(process.argv[3]) || MAX_BROWSERS, MAX_BROWSERS);
    console.log(`=== Parallel Mode (${concurrency} concurrent) ===\n`);

    const results = [];
    const promises = [];
    let idx = 0;

    for (let i = 0; i < Math.min(concurrency, todo.length); i++) {
      promises.push(
        worker(todo[idx], idx + 1, todo.length).then(r => {
          results.push(r);
          // Chain next
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
    console.log("  node batch_register.js single           # Test 1 account");
    console.log("  node batch_register.js parallel [N]     # N concurrent (max 4)");
  }

  // Final cleanup
  try { execSync("taskkill /F /IM msedge.exe 2>nul", { stdio: "ignore" }); } catch(e) {}
}

main().catch(e => {
  console.error("Fatal:", e);
  process.exit(1);
});
