/**
 * diag_turnstile.js — 诊断 Turnstile 扩展 + Cookie AT 获取
 */
const fs = require("fs");
const path = require("path");
const { launchBrowser, pollMagicLink } = require("./zo_register");

// Load a fresh account
const lines = fs.readFileSync("C:\\Users\\XZXyuan\\Downloads\\100个Outlook邮箱.txt", "utf8").split("\n").filter(l => l.trim());
// Find caleb79 (not yet registered)
const line = lines.find(l => l.includes("caleb79"));
const parts = line.split(/-{3,}/);
const account = { email: parts[0].trim(), password: parts[1].trim(), clientId: parts[2].trim(), refreshToken: parts[3].trim() };

console.log("Testing with:", account.email);
console.log("clientId:", account.clientId);

async function main() {
  const log = (msg) => console.log(`[DIAG] ${msg}`);
  const config = { browserType: "edge", registeredDir: path.join(__dirname, "..", "registered") };

  log("Launching browser...");
  const { browser, page, tempDir } = await launchBrowser(config, log);
  page.setDefaultTimeout(60000);
  await page.setViewport({ width: 1440, height: 900 });

  // Open signup
  log("Opening signup...");
  await page.goto("https://www.zo.computer/signup", { waitUntil: "domcontentloaded", timeout: 45000 });
  await new Promise(r => setTimeout(r, 3000));

  // Click "Email me a sign-up link"
  log("Looking for email button...");
  let clicked = false;
  for (let attempt = 0; attempt < 3 && !clicked; attempt++) {
    const btns = await page.$$("button");
    for (const btn of btns) {
      const txt = await btn.evaluate(e => e.textContent).catch(() => "");
      if (/Email me a sign-up link/i.test(txt)) { await btn.click(); clicked = true; break; }
    }
    if (!clicked) await new Promise(r => setTimeout(r, 2000));
  }
  log("Button: " + (clicked ? "OK" : "FAILED"));
  await new Promise(r => setTimeout(r, 2000));

  // Fill email
  log("Filling email...");
  let emailInput = await page.$("input[type=email]");
  if (!emailInput) {
    for (const inp of await page.$$("input")) {
      const ph = await inp.evaluate(e => e.placeholder || "").catch(() => "");
      if (/email/i.test(ph)) { emailInput = inp; break; }
    }
  }
  if (emailInput) {
    await emailInput.click({ clickCount: 3 });
    await emailInput.type(account.email, { delay: 30 });
    await new Promise(r => setTimeout(r, 500));
  }
  // Click Continue
  for (const btn of await page.$$("button")) {
    const txt = await btn.evaluate(e => e.textContent.trim()).catch(() => "");
    if (/^Continue$/i.test(txt)) { await btn.click(); break; }
  }
  await new Promise(r => setTimeout(r, 5000));

  const pageText = await page.evaluate(() => document.body?.innerText?.substring(0, 200) || "").catch(() => "");
  log("After continue: " + pageText.substring(0, 80));

  // Poll for magic link
  log("Polling...");
  const sendTime = new Date(Date.now() - 5000);
  const result = await pollMagicLink(account.email, account.clientId, account.refreshToken, sendTime, log, config);
  if (!result) { log("No magic link!"); await browser.close(); return; }
  log("Link: " + result.link.substring(0, 80));

  // Open magic link
  log("Opening magic link...");
  try { await page.goto(result.link, { waitUntil: "domcontentloaded", timeout: 60000 }); } catch(e) { log("Nav: " + e.message.substring(0, 50)); }
  await new Promise(r => setTimeout(r, 3000));

  // Monitor
  log("=== MONITORING ===");
  for (let i = 0; i < 24; i++) {
    const url = page.url();
    const text = await page.evaluate(() => document.body?.innerText?.substring(0, 200) || "").catch(() => "");
    const tsInfo = await page.evaluate(() => {
      const iframes = [...document.querySelectorAll('iframe')].map(f => ({ src: f.src?.substring(0, 100) || 'no-src', w: f.width, h: f.height }));
      return {
        turnstile: typeof window.turnstile !== 'undefined',
        cfInput: document.querySelector('input[name="cf-turnstile-response"]')?.value?.substring(0, 20) || false,
        iframes,
        title: document.title,
      };
    }).catch(() => ({}));

    log(`[${i*5}s] URL: ${url.substring(0, 70)}`);
    log(`  Title: ${tsInfo.title || 'N/A'}`);
    log(`  Text: ${text.substring(0, 100).replace(/\n/g, ' | ')}`);
    log(`  Turnstile global: ${tsInfo.turnstile} | CF input: ${tsInfo.cfInput || 'none'} | iframes: ${tsInfo.iframes?.length || 0}`);
    if (tsInfo.iframes?.length > 0) {
      tsInfo.iframes.forEach(f => log(`    iframe: ${f.src} (${f.w}x${f.h})`));
    }

    // Check for subdomain redirect
    try {
      const hn = new URL(url).hostname;
      if (hn.endsWith('.zo.computer') && hn !== 'www.zo.computer') {
        log(`\n✅ AT SUBDOMAIN: ${url}`);
        const cookies = await page.cookies();
        log(`Total cookies: ${cookies.length}`);
        const atCookie = cookies.find(c => c.name === 'access_token');
        if (atCookie) {
          log(`\n🎉 ACCESS_TOKEN COOKIE FOUND!`);
          log(`  Domain: ${atCookie.domain}`);
          log(`  Value: ${atCookie.value.substring(0, 60)}...`);
          log(`  Length: ${atCookie.value.length}`);
          log(`  Starts with eyJ: ${atCookie.value.startsWith('eyJ')}`);
        } else {
          log(`\n⚠️ No access_token cookie. Listing all:`);
          cookies.forEach(c => log(`  ${c.name} (${c.domain}) = ${(c.value || '').substring(0, 30)}...`));
        }
        break;
      }
    } catch(e) {}

    await new Promise(r => setTimeout(r, 5000));
  }

  await browser.close();
  log("Done.");
}

main().catch(e => { console.error("Fatal:", e); process.exit(1); });
