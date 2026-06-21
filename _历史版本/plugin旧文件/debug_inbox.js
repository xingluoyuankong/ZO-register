// 直接调试：创建邮箱 → 提交ZO → 手动查收件箱原始数据
const puppeteer = require("puppeteer-core");
const fs = require("fs");
const os = require("os");
const path = require("path");

async function main() {
  // 用 catchmail.io（最简单）
  const user = 'zodebug' + Math.random().toString(36).substring(2, 8);
  const email = user + '@catchmail.io';
  console.log('Email: ' + email);

  // 1. 提交到 ZO
  const extDir = path.join(__dirname, "..", "turnstile-extension");
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "zo_dbg_"));
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

  let accepted = false;
  for (let i = 0; i < 15; i++) {
    await new Promise(r => setTimeout(r, 2000));
    const txt = await page.evaluate(() => document.body.innerText.substring(0, 500));
    console.log('Page [' + (i*2) + 's]: ' + txt.substring(0, 80));
    if (/check your email|login link|we('ve| have) sent/i.test(txt)) { accepted = true; break; }
  }
  console.log('ZO accepted: ' + accepted);
  await browser.close();

  // 2. 轮询 catchmail.io 收件箱 - 打印原始 JSON
  console.log('\n=== Polling catchmail.io inbox (raw JSON) ===');
  for (let i = 0; i < 40; i++) {  // 200 seconds
    await new Promise(r => setTimeout(r, 5000));
    try {
      const r = await fetch('https://api.catchmail.io/api/v1/mailbox?address=' + email);
      const raw = await r.text();
      const data = JSON.parse(raw);
      const count = (data.messages || []).length;
      if (count > 0) {
        console.log('\n🎉 GOT MAIL at poll #' + (i+1) + '!');
        console.log('RAW: ' + raw.substring(0, 500));
        for (const m of data.messages) {
          console.log('  Subject: ' + (m.subject || m.Subject || ''));
          console.log('  From: ' + (m.from || m.From || ''));
          console.log('  Keys: ' + Object.keys(m).join(', '));
          
          // Get detail
          const msgId = m.id || m.message_id || m.ID;
          if (msgId) {
            const dR = await fetch('https://api.catchmail.io/api/v1/message/' + msgId + '?mailbox=' + email);
            const dRaw = await dR.text();
            console.log('  Detail: ' + dRaw.substring(0, 500));
          }
        }
        return;
      }
      if ((i+1) % 6 === 0) console.log('Poll #' + (i+1) + ': ' + count + ' msgs (' + ((i+1)*5) + 's)');
    } catch(e) {
      console.log('Poll #' + (i+1) + ' error: ' + e.message);
    }
  }
  console.log('Timeout - no mail received');
}

main().catch(e => { console.error(e); process.exit(1); });
