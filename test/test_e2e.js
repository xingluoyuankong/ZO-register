// 完整端到端测试：正确点击 "Email me a sign-up link" → 填邮箱 → 等确认 → 轮询收件
const puppeteer = require("puppeteer-core");
const fs = require("fs");
const os = require("os");
const path = require("path");

async function submitToZO(page, email) {
  await page.goto("https://www.zo.computer/signup", { waitUntil: "domcontentloaded", timeout: 30000 });
  await new Promise(r => setTimeout(r, 3000));

  // ✅ 精确点击 "Email me a sign-up link"
  const btns = await page.$$("button");
  for (const btn of btns) {
    const txt = await btn.evaluate(e => e.textContent.trim()).catch(() => "");
    if (/Email me a sign-up link/i.test(txt)) { await btn.click(); break; }
  }
  await new Promise(r => setTimeout(r, 2000));

  // 找 email input
  const inputs = await page.$$("input");
  let emailInput = null;
  for (const inp of inputs) {
    const info = await inp.evaluate(e => ({ type: e.type, ph: e.placeholder, name: e.name, id: e.id })).catch(() => ({}));
    if (/email/i.test(info.type + " " + info.ph + " " + info.name + " " + info.id)) { emailInput = inp; break; }
  }
  if (!emailInput) throw new Error("No email input after click");

  await emailInput.click({ clickCount: 3 });
  await emailInput.type(email, { delay: 15 });
  await new Promise(r => setTimeout(r, 300));

  // Continue
  const cBtns = await page.$$("button");
  for (const btn of cBtns) {
    const txt = await btn.evaluate(e => e.textContent.trim()).catch(() => "");
    if (/^Continue$/i.test(txt)) { await btn.click(); break; }
  }

  // 等确认
  for (let i = 0; i < 20; i++) {
    await new Promise(r => setTimeout(r, 2000));
    const txt = await page.evaluate(() => document.body.innerText.substring(0, 500));
    if (/check your email|login link|we('ve| have) sent/i.test(txt)) return true;
  }
  return false;
}

async function main() {
  const providers = ['maildrop', 'mailtm', 'guerrilla', 'catchmail', 'inboxes'];
  const extDir = path.join(__dirname, "..", "turnstile-extension");
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "zo_e2e_"));
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
  const tempMail = require("./temp_mail");
  const created = [];

  for (const pName of providers) {
    try {
      const r = await tempMail.createEmail({ provider: pName });
      console.log(`\n--- ${pName}: ${r.email} ---`);
      const accepted = await submitToZO(page, r.email);
      console.log(accepted ? '  ✅ ZO accepted' : '  ❌ No confirmation');
      if (accepted) created.push(r);
    } catch(e) {
      console.log(`  ❌ ${e.message}`);
    }
  }
  await browser.close();

  if (!created.length) { console.log("No submissions succeeded"); return; }

  // 轮询 5 分钟
  console.log(`\n=== Polling ${created.length} inboxes for 5 min ===`);
  const found = {};
  const start = Date.now();
  const POLL = 300000;

  while (Date.now() - start < POLL) {
    for (const r of created) {
      if (found[r.provider]) continue;
      try {
        const msgs = await r.providerInstance.getMessages(r.credentials);
        if (msgs.length > 0) {
          // 打印所有消息
          for (const m of msgs) {
            console.log(`  [${r.provider}] Subject="${m.subject}" From="${m.from}"`);
            if (!found[r.provider] && /zo|login|magic|sign|link/i.test(m.subject + " " + m.from)) {
              found[r.provider] = m;
              console.log(`  🎉 ${r.provider} GOT ZO EMAIL! (${Math.round((Date.now()-start)/1000)}s)`);
              // Get detail
              const detail = await r.providerInstance.getMessageDetail(r.credentials, m.id);
              if (detail) {
                const links = (detail.html + " " + detail.text).match(/https?:\/\/[^\s"'<>]+/gi) || [];
                const zoLinks = links.filter(l => /zo\.computer/i.test(l));
                console.log(`  Links: ${zoLinks.slice(0,3).join(', ') || links.slice(0,3).join(', ')}`);
              }
            }
          }
        }
      } catch(e) {}
    }
    
    const elapsed = Math.round((Date.now()-start)/1000);
    const remaining = Math.round((POLL - (Date.now()-start))/1000);
    const fCount = Object.keys(found).length;
    process.stdout.write(`\r  ${elapsed}s | found=${fCount}/${created.length} | remaining=${remaining}s    `);
    
    if (fCount === created.length) break;
    await new Promise(r => setTimeout(r, 5000));
  }

  console.log('\n\n========== RESULT ==========');
  for (const r of created) {
    const f = found[r.provider];
    console.log(`${f ? '✅' : '❌'} ${r.provider.padEnd(14)} | ${r.email} | ${f ? f.subject.substring(0,50) : 'NO EMAIL'}`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
