// 直接打开网页界面看收件
const puppeteer = require("puppeteer-core");
const fs = require("fs");
const os = require("os");
const path = require("path");

async function main() {
  const user = 'zotest' + Math.random().toString(36).substring(2, 8);
  const email = user + '@catchmail.io';
  console.log('Email: ' + email);

  const extDir = path.join(__dirname, "..", "turnstile-extension");
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "zo_ui_"));
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
  await new Promise(r => setTimeout(r, 2000));

  const btns = await page.$$("button");
  for (const btn of btns) {
    const txt = await btn.evaluate(e => e.textContent).catch(() => "");
    if (/Email me/i.test(txt)) { await btn.click(); break; }
  }
  await new Promise(r => setTimeout(r, 2000));

  const allInputs = await page.$$("input");
  let emailInput = null;
  for (const inp of allInputs) {
    const info = await inp.evaluate(e => ({ ph: e.placeholder||"", type: e.type||"" })).catch(() => ({}));
    if (/email/i.test(info.ph + " " + info.type)) { emailInput = inp; break; }
  }
  if (!emailInput) { console.log("NO INPUT"); await browser.close(); return; }
  await emailInput.click({ clickCount: 3 });
  await emailInput.type(email, { delay: 15 });
  await new Promise(r => setTimeout(r, 300));

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

  // 打开收件箱网页
  console.log('Opening catchmail.io inbox...');
  const page2 = await browser.newPage();
  await page2.goto('https://catchmail.io/inbox/' + email, { waitUntil: "domcontentloaded", timeout: 30000 });
  
  console.log('Watching for emails (120s)...');
  for (let i = 0; i < 24; i++) {
    await new Promise(r => setTimeout(r, 5000));
    const txt = await page2.evaluate(() => document.body.innerText);
    if (/zo|login|magic/i.test(txt)) {
      console.log('\n🎉 GOT EMAIL at ' + ((i+1)*5) + 's!');
      console.log(txt.substring(0, 500));
      await browser.close();
      return;
    }
    if ((i+1) % 6 === 0) console.log((i+1)*5 + 's: no mail yet');
  }
  
  console.log('Timeout');
  await browser.close();
}

main().catch(e => { console.error(e); process.exit(1); });
