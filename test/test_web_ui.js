// 打开各服务的网页收件界面直接看
const puppeteer = require("puppeteer-core");
const fs = require("fs");
const os = require("os");
const path = require("path");

async function main() {
  // 用 maildrop.cc（网页界面最简单）
  const user = 'zotest' + Math.random().toString(36).substring(2, 8);
  const email = user + '@maildrop.cc';
  console.log('Email: ' + email);

  const extDir = path.join(__dirname, "..", "turnstile-extension");
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "zo_web_"));
  const browser = await puppeteer.launch({
    executablePath: "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    headless: false,
    userDataDir: tempDir,
    args: ["--no-first-run", "--no-default-browser-check", "--no-sandbox",
      "--load-extension=" + extDir, "--window-size=1440,900"],
    defaultViewport: { width: 1440, height: 900 },
    ignoreDefaultArgs: ["--enable-automation"],
  });

  const page = (await browser.pages())[0] || await browser.newPage();
  
  // 提交到 ZO
  console.log('Submitting to ZO...');
  await page.goto("https://www.zo.computer/signup", { waitUntil: "domcontentloaded", timeout: 30000 });
  await new Promise(r => setTimeout(r, 3000));

  // 找 email input（多种方式）
  let emailInput = await page.$("input[type='email']");
  if (!emailInput) {
    const inputs = await page.$$("input");
    for (const inp of inputs) {
      const info = await inp.evaluate(e => ({
        ph: e.placeholder || "", type: e.type || "", name: e.name || "", id: e.id || ""
      })).catch(() => ({}));
      if (/email/i.test(info.ph + info.type + info.name + info.id)) {
        emailInput = inp;
        break;
      }
    }
  }
  
  if (!emailInput) {
    console.log("NO EMAIL INPUT - dumping page inputs:");
    const allInputs = await page.$$("input");
    for (const inp of allInputs) {
      const info = await inp.evaluate(e => ({
        ph: e.placeholder, type: e.type, name: e.name, id: e.id
      })).catch(() => ({}));
      console.log("  ", JSON.stringify(info));
    }
    await browser.close();
    return;
  }
  
  await emailInput.click({ clickCount: 3 });
  await emailInput.type(email, { delay: 20 });
  await new Promise(r => setTimeout(r, 500));

  // 找 Continue 按钮
  const buttons = await page.$$("button");
  for (const btn of buttons) {
    const txt = await btn.evaluate(e => e.textContent.trim()).catch(() => "");
    if (/^continue$/i.test(txt)) { await btn.click(); break; }
  }

  // 等 ZO 确认
  for (let i = 0; i < 15; i++) {
    await new Promise(r => setTimeout(r, 2000));
    const txt = await page.evaluate(() => document.body.innerText.substring(0, 500));
    if (/check your email|login link/i.test(txt)) {
      console.log('✅ ZO accepted at ' + ((i+1)*2) + 's');
      break;
    }
  }

  // 打开 maildrop.cc 收件网页
  console.log('Opening maildrop.cc inbox...');
  const page2 = await browser.newPage();
  await page2.goto('https://maildrop.cc/inbox?mailbox=' + user, { waitUntil: "domcontentloaded", timeout: 30000 });
  
  // 轮询看网页
  for (let i = 0; i < 36; i++) {  // 3 分钟
    await new Promise(r => setTimeout(r, 5000));
    
    // 刷新
    await page2.reload({ waitUntil: "domcontentloaded" });
    await new Promise(r => setTimeout(r, 1000));
    
    const txt = await page2.evaluate(() => document.body.innerText);
    if (/zo\.computer|login|magic/i.test(txt)) {
      console.log('\n🎉 GOT EMAIL at ' + ((i+1)*6) + 's!');
      console.log(txt.substring(0, 600));
      await browser.close();
      return;
    }
    
    if ((i+1) % 6 === 0) {
      console.log(((i+1)*6) + 's: ' + txt.substring(0, 100).replace(/\n/g, ' '));
    }
  }
  
  console.log('Timeout');
  await browser.close();
}

main().catch(e => { console.error(e); process.exit(1); });
