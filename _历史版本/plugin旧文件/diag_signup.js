/**
 * 诊断 /signup 页面结构
 * 测试账号: ian51snofmorkf4ihj@outlook.com
 */

const fs = require("fs");
const path = require("path");
const { launchBrowser, getMailToken, findMagicLink, pollMagicLink } = require("./zo_register");

const ACCOUNT_FILE = "C:\\Users\\XZXyuan\\Downloads\\zo_all.txt";
const TEST_EMAIL = "ian51snofmorkf4ihj@outlook.com";

async function main() {
  console.log("=== /signup 页面诊断 ===\n");
  
  // 读取账号
  const lines = fs.readFileSync(ACCOUNT_FILE, "utf8").split("\n");
  let account = null;
  for (const line of lines) {
    const parts = line.split("----");
    if (parts.length >= 4 && parts[0].trim() === TEST_EMAIL) {
      account = {
        email: parts[0].trim(),
        clientId: parts[2].trim(),
        refreshToken: parts[3].trim(),
      };
      break;
    }
  }
  
  if (!account) { console.error("账号未找到"); process.exit(1); }
  
  const log = (msg) => console.log(`[${new Date().toLocaleTimeString()}] ${msg}`);
  
  // 启动浏览器
  log("启动浏览器...");
  const { browser, page, tempDir } = await launchBrowser({}, log);
  
  try {
    // 打开 signup 页
    log("打开 https://www.zo.computer/signup ...");
    await page.goto("https://www.zo.computer/signup", { waitUntil: "domcontentloaded", timeout: 30000 });
    await new Promise(r => setTimeout(r, 2000));
    
    // 点击 email 按钮
    log("点击 email 按钮...");
    const btns = await page.$$("button");
    for (const btn of btns) {
      const txt = await btn.evaluate(e => e.textContent).catch(() => "");
      if (/Email me a sign-up link/i.test(txt)) { await btn.click(); break; }
    }
    await new Promise(r => setTimeout(r, 2000));
    
    // 填写邮箱
    log("填写邮箱...");
    const input = await page.$("input[type=email], input[name=email], input[placeholder*=email i]");
    if (input) {
      await input.click({ clickCount: 3 });
      await input.type(account.email, { delay: 30 });
      await new Promise(r => setTimeout(r, 500));
    }
    
    // 点击 Continue
    log("点击 Continue...");
    for (const btn of await page.$$("button")) {
      const txt = await btn.evaluate(e => e.textContent).catch(() => "");
      if (/^Continue$/i.test(txt)) { await btn.click(); break; }
    }
    
    // 等待邮件发送确认
    log("等待邮件发送确认...");
    for (let i = 0; i < 15; i++) {
      await new Promise(r => setTimeout(r, 1000));
      const txt = await page.evaluate(() => document.body.innerText.substring(0, 500)).catch(() => "");
      if (/check your email|login link/i.test(txt)) { log("✅ 邮件已发送"); break; }
    }
    
    // 获取 magic link
    log("轮询 magic link...");
    const sendTime = new Date();
    const result = await pollMagicLink(account.email, account.clientId, account.refreshToken, sendTime, log, {});
    if (!result) { log("❌ Magic link 未找到"); return; }
    
    // 打开 magic link
    log("打开 magic link...");
    await page.goto(result.link, { waitUntil: "domcontentloaded", timeout: 30000 });
    
    // 等待 Turnstile + redirect
    log("等待 Turnstile + redirect...");
    for (let i = 0; i < 30; i++) {
      await new Promise(r => setTimeout(r, 2000));
      const url = page.url();
      log(`[${i*2}s] URL: ${url}`);
      if (url.includes("/signup") && !url.includes("email-login")) {
        log("✅ 到达 /signup 页面");
        break;
      }
      if (/zo\.computer/.test(url) && !/signup|verify|email-login/i.test(url)) {
        log("✅ 已跳转到 workspace");
        return;
      }
    }
    
    // 诊断 /signup 页面结构
    log("\n=== /signup 页面诊断 ===");
    const url = page.url();
    log("当前 URL: " + url);
    
    const bodyText = await page.evaluate(() => document.body.innerText.substring(0, 1000)).catch(() => "");
    log("页面文本 (前1000字符):\n" + bodyText);
    
    const inputs = await page.evaluate(() => {
      return Array.from(document.querySelectorAll("input")).map(i => ({
        type: i.type, name: i.name, placeholder: i.placeholder, id: i.id, className: i.className,
        rect: i.getBoundingClientRect()
      }));
    }).catch(() => []);
    log("\n所有 input 元素:");
    for (const inp of inputs) {
      log(`  type=${inp.type} name=${inp.name} placeholder=${inp.placeholder} id=${inp.id} class=${inp.className.substring(0, 50)}`);
      log(`    rect: ${JSON.stringify(inp.rect)}`);
    }
    
    const buttons = await page.evaluate(() => {
      return Array.from(document.querySelectorAll("button")).map(b => ({
        text: (b.textContent || '').trim().substring(0, 50),
        rect: b.getBoundingClientRect()
      }));
    }).catch(() => []);
    log("\n所有 button 元素:");
    for (const btn of buttons) {
      log(`  text="${btn.text}" rect=${JSON.stringify(btn.rect)}`);
    }
    
    // 截图
    const screenshotPath = "E:\\API获取工具\\ZO注册\\plugin\\diag_signup_page.png";
    await page.screenshot({ path: screenshotPath, fullPage: true });
    log("\n截图已保存: " + screenshotPath);
    
  } finally {
    await browser.close().catch(() => {});
    try { require("child_process").execSync(`rmdir /s /q "${tempDir}"`, { stdio: "ignore" }); } catch(e) {}
  }
  
  console.log("\n=== 诊断完成 ===");
}

main().catch(e => { console.error(e); process.exit(1); });
