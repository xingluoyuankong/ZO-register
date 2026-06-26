/**
 * 简单诊断 /signup 页面 - 输出到文件
 */
const fs = require("fs");
const { launchBrowser, getMailToken, findMagicLink, pollMagicLink } = require("./zo_register");

const ACCOUNT_FILE = "C:\\Users\\XZXyuan\\Downloads\\zo_all.txt";
const TEST_EMAIL = "ian51snofmorkf4ihj@outlook.com";
const OUTPUT_FILE = "E:\\API获取工具\\ZO注册\\plugin\\diag_result.txt";

async function main() {
  const output = [];
  const log = (msg) => { console.log(msg); output.push(msg); };
  
  log("=== /signup 页面诊断 ===\n");
  
  // 读取账号
  const lines = fs.readFileSync(ACCOUNT_FILE, "utf8").split("\n");
  let account = null;
  for (const line of lines) {
    const parts = line.split("----");
    if (parts.length >= 4 && parts[0].trim() === TEST_EMAIL) {
      account = { email: parts[0].trim(), clientId: parts[2].trim(), refreshToken: parts[3].trim() };
      break;
    }
  }
  if (!account) { log("账号未找到"); fs.writeFileSync(OUTPUT_FILE, output.join("\n")); process.exit(1); }
  
  const { browser, page, tempDir } = await launchBrowser({}, log);
  
  try {
    log("打开 signup 页...");
    await page.goto("https://www.zo.computer/signup", { waitUntil: "domcontentloaded", timeout: 30000 });
    await new Promise(r => setTimeout(r, 2000));
    
    log("点击 email 按钮...");
    for (const btn of await page.$$("button")) {
      const txt = await btn.evaluate(e => e.textContent).catch(() => "");
      if (/Email me a sign-up link/i.test(txt)) { await btn.click(); break; }
    }
    await new Promise(r => setTimeout(r, 2000));
    
    log("填写邮箱...");
    const input = await page.$("input[type=email], input[name=email]");
    if (input) { await input.click({ clickCount: 3 }); await input.type(account.email, { delay: 30 }); }
    await new Promise(r => setTimeout(r, 500));
    
    log("点击 Continue...");
    for (const btn of await page.$$("button")) {
      const txt = await btn.evaluate(e => e.textContent).catch(() => "");
      if (/^Continue$/i.test(txt)) { await btn.click(); break; }
    }
    
    log("等待邮件发送确认...");
    for (let i = 0; i < 15; i++) {
      await new Promise(r => setTimeout(r, 1000));
      const txt = await page.evaluate(() => document.body.innerText.substring(0, 500)).catch(() => "");
      if (/check your email|login link/i.test(txt)) { log("✅ 邮件已发送"); break; }
    }
    
    log("轮询 magic link...");
    const result = await pollMagicLink(account.email, account.clientId, account.refreshToken, new Date(), log, {});
    if (!result) { log("❌ Magic link 未找到"); return; }
    
    log("打开 magic link...");
    await page.goto(result.link, { waitUntil: "domcontentloaded", timeout: 30000 });
    
    log("等待 redirect...");
    for (let i = 0; i < 30; i++) {
      await new Promise(r => setTimeout(r, 2000));
      const url = page.url();
      log(`[${i*2}s] URL: ${url}`);
      if (url.includes("/signup") && !url.includes("email-login")) break;
      if (/zo\.computer/.test(url) && !/signup|verify|email-login/i.test(url)) { log("✅ 已跳转到 workspace"); return; }
    }
    
    // 诊断页面结构
    log("\n=== /signup 页面结构 ===");
    log("URL: " + page.url());
    
    const bodyText = await page.evaluate(() => document.body.innerText).catch(() => "");
    log("\n页面文本:\n" + bodyText.substring(0, 1500));
    
    const inputs = await page.evaluate(() => {
      return Array.from(document.querySelectorAll("input")).map(i => ({
        type: i.type, name: i.name, placeholder: i.placeholder, id: i.id, visible: i.offsetWidth > 0
      }));
    }).catch(() => []);
    log("\n所有 input:");
    inputs.forEach(i => log(`  type=${i.type} name=${i.name} placeholder="${i.placeholder}" id=${i.id} visible=${i.visible}`));
    
    const buttons = await page.evaluate(() => {
      return Array.from(document.querySelectorAll("button")).map(b => ({
        text: (b.textContent || '').trim().substring(0, 50), visible: b.offsetWidth > 0
      }));
    }).catch(() => []);
    log("\n所有 button:");
    buttons.forEach(b => log(`  text="${b.text}" visible=${b.visible}`));
    
  } finally {
    await browser.close().catch(() => {});
    try { require("child_process").execSync(`rmdir /s /q "${tempDir}"`, { stdio: "ignore" }); } catch(e) {}
  }
  
  fs.writeFileSync(OUTPUT_FILE, output.join("\n"));
  log("\n结果已保存到 " + OUTPUT_FILE);
}

main().catch(e => { fs.writeFileSync(OUTPUT_FILE, "ERROR: " + e.message); console.error(e); process.exit(1); });
