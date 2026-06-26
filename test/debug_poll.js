// Debug: 创建 Mail.tm → 提交 ZO → 用 registerOne 同款 pollInbox 轮询
const puppeteer = require("puppeteer-core");
const tempMail = require("./temp_mail");
const fs = require("fs");
const os = require("os");
const path = require("path");

async function main() {
  // 1. Create Mail.tm email (same as registerOne)
  const result = await tempMail.createEmail({ providers: ['mailtm'], log: console.log });
  console.log('Email: ' + result.email);
  console.log('Credentials: ' + JSON.stringify(result.credentials));
  console.log('Provider: ' + result.provider);

  // 2. Submit to ZO
  const extDir = path.join(__dirname, "..", "turnstile-extension");
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "zo_dbg2_"));
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
  await page.goto("https://www.zo.computer/signup", { waitUntil: "domcontentloaded", timeout: 30000 });
  await new Promise(r => setTimeout(r, 3000));

  // Click "Email me a sign-up link"
  const btns = await page.$$("button");
  for (const btn of btns) {
    const txt = await btn.evaluate(e => e.textContent.trim()).catch(() => "");
    if (/Email me a sign-up link/i.test(txt)) { await btn.click(); break; }
  }
  await new Promise(r => setTimeout(r, 2000));

  // Fill email
  const allInputs = await page.$$("input");
  let emailInput = null;
  for (const inp of allInputs) {
    const info = await inp.evaluate(e => ({ type: e.type, ph: e.placeholder, name: e.name })).catch(() => ({}));
    if (/email/i.test(info.type + " " + info.ph + " " + info.name)) { emailInput = inp; break; }
  }
  if (!emailInput) { console.log("NO INPUT"); await browser.close(); return; }
  await emailInput.click({ clickCount: 3 });
  await emailInput.type(result.email, { delay: 15 });
  await new Promise(r => setTimeout(r, 300));

  // Continue
  const cBtns = await page.$$("button");
  for (const btn of cBtns) {
    const txt = await btn.evaluate(e => e.textContent.trim()).catch(() => "");
    if (/^Continue$/i.test(txt)) { await btn.click(); break; }
  }

  for (let i = 0; i < 15; i++) {
    await new Promise(r => setTimeout(r, 2000));
    const txt = await page.evaluate(() => document.body.innerText.substring(0, 500));
    if (/check your email|login link/i.test(txt)) { console.log('✅ ZO accepted'); break; }
  }
  await browser.close();

  // 3. Poll using EXACT same pollInbox function from temp_mail.js
  console.log('\n=== Polling with temp_mail.pollInbox ===');
  try {
    const inboxResult = await tempMail.pollInbox(result.email, result.credentials, {
      keyword: 'zo',
      provider: result.provider,
      providerInstance: result.providerInstance,
      timeout: 30,
      interval: 2000,
      log: console.log,
    });
    console.log('\n🎉 FOUND! Links: ' + inboxResult.links.slice(0, 3).join('\n'));
  } catch(e) {
    console.log('\n❌ pollInbox error: ' + e.message);
    
    // 4. Manual debug: raw API call
    console.log('\n=== Manual debug ===');
    const p = result.providerInstance;
    const raw = await fetch(p.base + '/messages', {
      headers: { 'Authorization': 'Bearer ' + result.credentials.token }
    });
    console.log('Raw API: ' + raw.status + ' ' + (await raw.text()).substring(0, 500));
  }
}

main().catch(e => { console.error(e); process.exit(1); });
