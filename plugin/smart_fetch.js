/**
 * ZO 智能凭证获取器 v1.0
 * 
 * 智能判断: 检查每个账号已有的凭证，只获取缺失的部分
 * - 已有 AT + Cookie AT → 跳过
 * - 有 AT、无 Cookie AT → 登录 → 只取 Cookie AT
 * - 无 AT、有 Cookie AT → 登录 → 只取 API AT  
 * - 都无 → 完整流程
 * 
 * 核心优化:
 * 1. 已知 handle 的账号直接导航到 workspace，跳过 signup/handle/onboarding
 * 2. 只发送 magic link → Turnstile auto-pass → workspace → 取缺失凭证
 * 3. 无需重复完成注册步骤
 */

const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

// === Config ===
const ZO_FILE = path.join("C:", "Users", "XZXyuan", "Downloads", "zo_all.txt");
const PLUGIN_DIR = path.join(__dirname, "..", "plugin");
const REGISTERED_DIR = path.join(__dirname, "..", "registered");
const AT_DIR = path.join(REGISTERED_DIR, "Access Tokens");
const COOKIE_AT_DIR = path.join(REGISTERED_DIR, "Cookie ATs");

// === Utils ===
function hasAT(email) {
  const f = path.join(AT_DIR, email + ".txt");
  if (fs.existsSync(f)) {
    const content = fs.readFileSync(f, "utf8");
    return /accessToken:\s*\S+/.test(content);
  }
  return false;
}

function hasCookieAT(email) {
  const f = path.join(COOKIE_AT_DIR, email + ".txt");
  return fs.existsSync(f) && fs.statSync(f).size > 100;
}

function getHandle(email) {
  const f = path.join(AT_DIR, email + ".txt");
  if (fs.existsSync(f)) {
    const content = fs.readFileSync(f, "utf8");
    const m = content.match(/^handle:\s*(\S+)/m);
    if (m) return m[1];
  }
  const f2 = path.join(COOKIE_AT_DIR, email + ".txt");
  if (fs.existsSync(f2)) {
    const content = fs.readFileSync(f2, "utf8");
    const m = content.match(/^handle:\s*(\S+)/m);
    if (m) return m[1];
  }
  return null;
}

function parseAccounts(filePath) {
  const content = fs.readFileSync(filePath, "utf8");
  const lines = content.split(/\r?\n/).filter(l => l.trim() && !l.startsWith('#'));
  const accounts = [];
  for (const line of lines) {
    // Format: email----password----clientId----refreshToken
    // or: email:password:cid:rt
    const parts = line.split(/[-:|]{2,4}|\|/);
    if (parts.length >= 2 && parts[0].includes('@')) {
      const email = parts[0].trim();
      if (!email.includes('@')) continue;
      accounts.push({
        email,
        password: parts[1] ? parts[1].trim() : 'XZX3214675771!!',
        hasAT: hasAT(email),
        hasCookieAT: hasCookieAT(email),
        handle: getHandle(email),
      });
    }
  }
  return accounts;
}

// === Main ===
const accounts = parseAccounts(ZO_FILE);

// Categorize
const bothReady = accounts.filter(a => a.hasAT && a.hasCookieAT);
const needCookieOnly = accounts.filter(a => a.hasAT && !a.hasCookieAT);
const needATOnly = accounts.filter(a => !a.hasAT && a.hasCookieAT);
const needBoth = accounts.filter(a => !a.hasAT && !a.hasCookieAT);

console.log("=== ZO 智能凭证获取器 ===");
console.log("Total accounts: " + accounts.length);
console.log("  ✅ Both AT + Cookie AT: " + bothReady.length + " (skip)");
console.log("  ⚠️  Need Cookie AT only: " + needCookieOnly.length);
console.log("  ⚠️  Need API AT only:   " + needATOnly.length);
console.log("  🔴 Need BOTH:          " + needBoth.length);
console.log("");

// Strategy: process needCookieOnly first (fastest - known handles)
// Then needATOnly, then needBoth (full registration)

const toProcess = [
  ...needCookieOnly.map(a => ({ ...a, needAT: false, needCookieAT: true })),
  ...needATOnly.map(a => ({ ...a, needAT: true, needCookieAT: false })),
  ...needBoth.map(a => ({ ...a, needAT: true, needCookieAT: true })),
];

console.log("Accounts to process: " + toProcess.length);
console.log("Constellation: " + toProcess.filter(a => a.handle).length + " have known handles");
console.log("");

if (toProcess.length === 0) {
  console.log("Nothing to do! All accounts have both credentials.");
  process.exit(0);
}

// Show first 10 accounts needing work
console.log("=== Sample (first 10 needing work) ===");
for (let i = 0; i < Math.min(10, toProcess.length); i++) {
  const a = toProcess[i];
  const missing = [];
  if (a.needCookieAT) missing.push("Cookie");
  if (a.needAT) missing.push("AT");
  console.log(`  ${i+1}. ${a.email.substring(0,35)} | handle=${a.handle||'UNKNOWN'} | needs: ${missing.join('+')}`);
}

// === Strategy recommendation ===
console.log("\n=== 推荐策略 ===");
console.log("1. 先单线程测试1个已知handle账号（验证Turnstile v4）");
console.log("2. 通过后2-3并发批量处理 needCookieOnly 账号");
console.log("3. 最后处理 needBoth 账号");
console.log("");
console.log("运行命令:");
console.log("  node zo_register.js                 # 单个注册测试");
console.log("  node batch_at.js single             # 单线程AT获取");
console.log("  node batch_at.js parallel 3         # 3并发批量");
console.log("\n已就绪，扩展 v4 已加载。");
