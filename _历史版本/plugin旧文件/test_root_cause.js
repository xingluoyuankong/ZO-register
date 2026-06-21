/**
 * 根因定位测试：
 * 1. 创建临时邮箱
 * 2. 用另一服务发测试邮件验证收件能力
 * 3. 提交到 ZO
 * 4. 轮询 5 分钟
 */
const puppeteer = require("puppeteer-core");
const tempMail = require("./temp_mail");
const fs = require("fs");
const os = require("os");
const path = require("path");

async function main() {
  const providers = ['maildrop', 'mailtm', 'guerrilla', 'catchmail', 'inboxes'];
  
  // 1) 先验证每个 provider 收件能力（用 guerrilla 给自己发一封）
  console.log("=== Phase 1: 验证收件能力 ===");
  const results = {};
  
  for (const pName of providers) {
    try {
      const r = await tempMail.createEmail({ provider: pName });
      results[pName] = r;
      console.log(`✅ ${pName}: ${r.email}`);
      
      // 立刻检查收件箱确认 API 正常
      const msgs = await r.providerInstance.getMessages(r.credentials);
      console.log(`   收件箱 API 正常, 当前 ${msgs.length} 封`);
    } catch(e) {
      console.log(`❌ ${pName}: ${e.message}`);
    }
  }

  // 2) 用浏览器提交到 ZO
  console.log("\n=== Phase 2: 提交到 ZO ===");
  const extDir = path.join(__dirname, "..", "turnstile-extension");
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "zo_root_"));
  const browser = await puppeteer.launch({
    executablePath: "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    headless: false,
    userDataDir: tempDir,
    args: ["--no-first-run", "--no-default-browser-check", "--no-sandbox",
      "--load-extension=" + extDir, "--window-size=1440,900"],
    defaultViewport: { width: 1440, height: 900 },
    ignoreDefaultArgs: ["--enable-automation"],
  });

  const pages = await browser.pages();
  const page = pages[0] || await browser.newPage();

  for (const [pName, r] of Object.entries(results)) {
    console.log(`\n--- ZO 提交: ${r.email} (${pName}) ---`);
    try {
      await page.goto("https://www.zo.computer/signup", { waitUntil: "domcontentloaded", timeout: 30000 });
      await new Promise(r => setTimeout(r, 2000));

      // Click "Email me a sign-up link"
      const btns = await page.$$("button");
      for (const btn of btns) {
        const txt = await btn.evaluate(e => e.textContent).catch(() => "");
        if (/Email me/i.test(txt)) { await btn.click(); break; }
      }
      await new Promise(r => setTimeout(r, 2000));

      // Fill email
      let emailInput = null;
      const allInputs = await page.$$("input");
      for (const inp of allInputs) {
        const info = await inp.evaluate(e => ({ ph: e.placeholder || "", type: e.type || "", name: e.name || "" })).catch(() => ({}));
        if (/email/i.test(info.ph + " " + info.type + " " + info.name)) { emailInput = inp; break; }
      }
      if (!emailInput) { console.log("❌ No email input found"); continue; }

      await emailInput.click({ clickCount: 3 });
      await new Promise(r => setTimeout(r, 100));
      await emailInput.type(r.email, { delay: 15 });
      await new Promise(r => setTimeout(r, 300));

      // Click Continue
      const cBtns = await page.$$("button");
      for (const btn of cBtns) {
        const txt = await btn.evaluate(e => e.textContent.trim()).catch(() => "");
        if (/^Continue$/i.test(txt)) { await btn.click(); break; }
      }

      // Wait for confirmation
      let accepted = false;
      for (let i = 0; i < 15; i++) {
        await new Promise(r => setTimeout(r, 2000));
        const txt = await page.evaluate(() => document.body.innerText.substring(0, 500));
        if (/check your email|login link|we('ve| have) sent/i.test(txt)) { accepted = true; break; }
        if (/not supported|invalid|blocked|disposable|rejected/i.test(txt)) {
          console.log(`❌ ZO rejected: ${txt.substring(0, 100)}`);
          break;
        }
      }
      results[pName].accepted = accepted;
      console.log(accepted ? "✅ ZO accepted" : "⚠️ No confirmation");
    } catch(e) {
      console.log("❌ Submit error: " + e.message);
    }
  }

  await browser.close();

  // 3) 轮询 5 分钟
  console.log("\n=== Phase 3: 轮询收件箱 5 分钟 ===");
  const POLL_TIME = 300000; // 5 minutes
  const INTERVAL = 5000;
  const startTime = Date.now();
  const found = {};
  
  while (Date.now() - startTime < POLL_TIME) {
    const elapsed = Math.round((Date.now() - startTime) / 1000);
    for (const [pName, r] of Object.entries(results)) {
      if (found[pName] || !r.accepted) continue;
      try {
        const msgs = await r.providerInstance.getMessages(r.credentials);
        const zoMsg = msgs.find(m => /zo|login|magic|sign/i.test(m.subject + " " + m.from));
        if (zoMsg) {
          found[pName] = zoMsg;
          console.log(`\n🎉 ${pName} 收到 ZO 邮件! (${elapsed}s)`);
          console.log(`   Subject: ${zoMsg.subject}`);
          console.log(`   From: ${zoMsg.from}`);
        }
      } catch(e) {}
    }
    
    const remaining = Math.round((POLL_TIME - (Date.now() - startTime)) / 1000);
    const foundCount = Object.keys(found).length;
    const pendingCount = Object.entries(results).filter(([k,v]) => v.accepted && !found[k]).length;
    process.stdout.write(`\r  ${elapsed}s elapsed | ${foundCount} found | ${pendingCount} pending | ${remaining}s remaining   `);
    
    if (pendingCount === 0) break;
    await new Promise(r => setTimeout(r, INTERVAL));
  }

  // 4) 总结
  console.log("\n\n========== 结果汇总 ==========");
  for (const [pName, r] of Object.entries(results)) {
    const f = found[pName];
    const icon = f ? "✅" : (r.accepted ? "❌" : "⚠️");
    console.log(`${icon} ${pName.padEnd(14)} | ${r.email.padEnd(40)} | accepted=${r.accepted} | zo_email=${f ? f.subject.substring(0,40) : "NONE"}`);
  }
  
  if (Object.keys(found).length === 0) {
    console.log("\n⚠️ 所有临时邮箱都没收到 ZO 邮件！");
    console.log("可能原因:");
    console.log("  1. ZO 屏蔽了临时邮箱域名");
    console.log("  2. ZO 邮件投递延迟超过 5 分钟");
    console.log("  3. 需要更长等待时间");
  } else {
    console.log("\n✅ 有 provider 能收到 ZO 邮件！");
  }
}

main().catch(e => { console.error(e); process.exit(1); });
