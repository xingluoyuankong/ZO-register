/**
 * Real ZO delivery test: create temp emails, submit each to ZO via browser, 
 * then check inboxes for ZO emails
 */
const puppeteer = require("puppeteer-core");
const tempMail = require("./temp_mail");
const fs = require("fs");
const os = require("os");
const path = require("path");

async function submitToZO(page, email) {
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
  let emailInput = await page.$("input[type=email], input#email, input[name=email]");
  if (!emailInput) {
    const allInputs = await page.$$("input");
    for (const inp of allInputs) {
      const ph = await inp.evaluate(e => (e.placeholder || "") + " " + (e.type || "")).catch(() => "");
      if (/email/i.test(ph)) { emailInput = inp; break; }
    }
  }
  if (!emailInput) throw new Error("No email input");
  
  await emailInput.click({ clickCount: 3 });
  await new Promise(r => setTimeout(r, 100));
  await emailInput.type(email, { delay: 20 });
  await new Promise(r => setTimeout(r, 300));
  
  // Click Continue
  const continueBtns = await page.$$("button");
  for (const btn of continueBtns) {
    const txt = await btn.evaluate(e => e.textContent.trim()).catch(() => "");
    if (/^Continue$/i.test(txt)) { await btn.click(); break; }
  }
  
  // Wait for "Check your email"
  for (let i = 0; i < 12; i++) {
    await new Promise(r => setTimeout(r, 2000));
    const txt = await page.evaluate(() => document.body.innerText.substring(0, 300));
    if (/check your email|login link|we sent/i.test(txt)) return true;
  }
  return false;
}

async function main() {
  console.log("=== ZO Delivery Test (Browser Submit → Inbox Check) ===\n");
  
  // Test top 4 most promising providers
  const testProviders = ['inboxes', 'tempmailplus', 'guerrilla', 'mailtm'];
  const results = [];
  
  // Launch browser once
  const extDir = path.join(__dirname, "..", "turnstile-extension");
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "zo_deliv_"));
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
  
  // Create all emails first
  const emailResults = [];
  for (const pName of testProviders) {
    try {
      const result = await tempMail.createEmail({ provider: pName, log: console.log });
      emailResults.push(result);
    } catch(e) {
      console.log('❌ ' + pName + ': ' + e.message);
      emailResults.push(null);
    }
  }
  
  // Submit each to ZO
  for (let i = 0; i < emailResults.length; i++) {
    const result = emailResults[i];
    if (!result) continue;
    
    console.log('\n--- Submitting: ' + result.email + ' (' + result.provider + ') ---');
    try {
      const accepted = await submitToZO(page, result.email);
      console.log('ZO response: ' + (accepted ? '✅ Accepted' : '❌ Rejected/Timeout'));
      if (!accepted) {
        results.push({ provider: result.provider, email: result.email, accepted: false });
        continue;
      }
    } catch(e) {
      console.log('Submit error: ' + e.message);
      results.push({ provider: result.provider, email: result.email, error: e.message });
      continue;
    }
    
    // Wait 30s for email delivery, then check
    console.log('  Waiting 30s for delivery...');
    await new Promise(r => setTimeout(r, 30000));
    
    // Check inbox
    try {
      const messages = await result.providerInstance.getMessages(result.credentials);
      console.log('  Messages: ' + messages.length);
      for (const msg of messages) {
        console.log('    ' + msg.subject.substring(0, 60) + ' | from: ' + msg.from.substring(0, 40));
      }
      const hasZo = messages.some(m => /zo/i.test(m.subject + ' ' + m.from));
      results.push({ provider: result.provider, email: result.email, accepted: true, 
        messages: messages.length, hasZoEmail: hasZo });
    } catch(e) {
      console.log('  Inbox check error: ' + e.message);
      results.push({ provider: result.provider, email: result.email, accepted: true, inboxError: e.message });
    }
  }
  
  // If no ZO emails found yet, wait another 60s and re-check all
  const needRecheck = results.filter(r => r.accepted && !r.hasZoEmail && !r.inboxError);
  if (needRecheck.length > 0) {
    console.log('\n--- Waiting another 60s, then re-checking all ---');
    await new Promise(r => setTimeout(r, 60000));
    
    for (const r of needRecheck) {
      const er = emailResults.find(e => e && e.provider === r.provider);
      if (!er) continue;
      try {
        const messages = await er.providerInstance.getMessages(er.credentials);
        console.log(r.provider + ': ' + messages.length + ' messages');
        for (const msg of messages) {
          console.log('  ' + msg.subject.substring(0, 60) + ' | from: ' + msg.from.substring(0, 40));
        }
        r.messages2 = messages.length;
        r.hasZoEmail2 = messages.some(m => /zo/i.test(m.subject + ' ' + m.from));
      } catch(e) {
        console.log(r.provider + ': recheck error: ' + e.message);
      }
    }
  }
  
  await browser.close();
  
  // Summary
  console.log('\n\n========== SUMMARY ==========');
  for (const r of results) {
    const zo = r.hasZoEmail || r.hasZoEmail2;
    const icon = zo ? '✅' : (r.accepted ? '⚠️' : '❌');
    console.log(icon + ' ' + r.provider.padEnd(14) + ' | ' + (r.email || '').padEnd(35) + ' | accepted=' + r.accepted + ' msgs=' + (r.messages || 0) + (r.messages2 ? '→' + r.messages2 : '') + ' zo=' + (zo || false));
  }
}

main().catch(console.error);
