/**
 * diag_verify_deep.js — 深度诊断 verify 页面跳转卡住问题
 */
const fs = require("fs");
const path = require("path");
const { launchBrowser, pollMagicLink } = require("./zo_register");

const lines = fs.readFileSync("C:\\Users\\XZXyuan\\Downloads\\100个Outlook邮箱.txt", "utf8").split("\n").filter(l => l.trim());
const line = lines.find(l => l.includes("caleb79"));  // caleb79 worked in previous test
const parts = line.split(/-{3,}/);
const account = { email: parts[0].trim(), clientId: parts[2].trim(), refreshToken: parts[3].trim() };
console.log("Testing with:", account.email);

async function main() {
  const log = (msg) => console.log(`[DIAG] ${msg}`);
  const config = { browserType: "edge", registeredDir: path.join(__dirname, "..", "registered") };

  const { browser, page } = await launchBrowser(config, log);
  page.setDefaultTimeout(60000);
  await page.setViewport({ width: 1440, height: 900 });

  // Capture console messages
  const consoleLogs = [];
  page.on('console', msg => {
    consoleLogs.push(`[${msg.type()}] ${msg.text()}`);
  });

  // Capture page errors
  page.on('pageerror', err => {
    consoleLogs.push(`[PAGE_ERROR] ${err.message}`);
  });

  // Capture failed requests
  page.on('requestfailed', req => {
    consoleLogs.push(`[REQ_FAIL] ${req.url().substring(0, 80)} → ${req.failure()?.errorText}`);
  });

  // Capture navigation responses
  page.on('response', resp => {
    if (resp.status() >= 400 || resp.url().includes('redirect') || resp.url().includes('verify')) {
      consoleLogs.push(`[RESP] ${resp.status()} ${resp.url().substring(0, 80)}`);
    }
  });

  // Step 1-4: Quick signup flow
  log("Opening signup...");
  await page.goto("https://www.zo.computer/signup", { waitUntil: "domcontentloaded", timeout: 45000 });
  await new Promise(r => setTimeout(r, 3000));

  // Click email button
  for (let a = 0; a < 3; a++) {
    for (const btn of await page.$$("button")) {
      const txt = await btn.evaluate(e => e.textContent).catch(() => "");
      if (/Email me a sign-up link/i.test(txt)) { await btn.click(); break; }
    }
    await new Promise(r => setTimeout(r, 1000));
    if (await page.$("input[type=email]")) break;
  }
  await new Promise(r => setTimeout(r, 1000));

  // Fill email
  const inp = await page.$("input[type=email]") || (await page.$$("input")).find(async i => /email/i.test(await i.evaluate(e => e.placeholder || "").catch(() => "")));
  if (inp) { await inp.click({ clickCount: 3 }); await inp.type(account.email, { delay: 30 }); }
  for (const btn of await page.$$("button")) {
    const txt = await btn.evaluate(e => e.textContent.trim()).catch(() => "");
    if (/^Continue$/i.test(txt)) { await btn.click(); break; }
  }
  await new Promise(r => setTimeout(r, 5000));

  // Poll magic link
  log("Polling...");
  const sendTime = new Date(Date.now() - 5000);
  const result = await pollMagicLink(account.email, account.clientId, account.refreshToken, sendTime, log, config);
  if (!result) { log("No link!"); await browser.close(); return; }
  log("Link: " + result.link.substring(0, 80));

  // Clear console logs before opening magic link
  consoleLogs.length = 0;

  // Open magic link
  log("Opening magic link...");
  try { await page.goto(result.link, { waitUntil: "domcontentloaded", timeout: 60000 }); } catch(e) {}
  await new Promise(r => setTimeout(r, 3000));

  // Deep analysis
  log("=== PAGE ANALYSIS ===");

  // Get full HTML (first 3000 chars)
  const html = await page.evaluate(() => document.documentElement.outerHTML.substring(0, 3000)).catch(() => "");
  log("HTML (first 1500):\n" + html.substring(0, 1500));

  // Check for meta refresh
  const metaRefresh = await page.evaluate(() => {
    const meta = document.querySelector('meta[http-equiv="refresh"]');
    return meta ? meta.content : null;
  }).catch(() => null);
  log("Meta refresh: " + (metaRefresh || "none"));

  // Check for redirect-related JS
  const jsInfo = await page.evaluate(() => {
    const scripts = [...document.querySelectorAll('script')].map(s => s.src || s.textContent?.substring(0, 200));
    const forms = [...document.querySelectorAll('form')].map(f => ({ action: f.action, method: f.method }));
    const links = [...document.querySelectorAll('a[href]')].map(a => a.href).slice(0, 10);
    return { scripts: scripts.filter(s => s).slice(0, 5), forms, links };
  }).catch(() => ({}));
  log("Scripts: " + JSON.stringify(jsInfo.scripts));
  log("Forms: " + JSON.stringify(jsInfo.forms));
  log("Links: " + JSON.stringify(jsInfo.links));

  // Wait 10 more seconds
  await new Promise(r => setTimeout(r, 10000));

  // Check URL again
  log("URL after 10s: " + page.url());

  // Print all console logs
  log("\n=== CONSOLE LOGS (" + consoleLogs.length + " entries) ===");
  for (const cl of consoleLogs) {
    log("  " + cl);
  }

  // Final: try manual navigation to the subdomain
  log("\n=== TRYING MANUAL REDIRECT ===");
  const handle = account.email.split('@')[0].substring(0, 8).toLowerCase().replace(/[^a-z0-9]/g, "");
  const targetUrl = `https://${handle}.zo.computer/`;
  log("Trying: " + targetUrl);
  try {
    await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 15000 });
    log("After nav: " + page.url());
    const text = await page.evaluate(() => document.body?.innerText?.substring(0, 200) || "").catch(() => "");
    log("Text: " + text.substring(0, 120));

    // Check cookies
    const cookies = await page.cookies();
    log("Total cookies: " + cookies.length);
    const atCookie = cookies.find(c => c.name === 'access_token');
    if (atCookie) {
      log(`\n🎉 ACCESS_TOKEN COOKIE: ${atCookie.value.substring(0, 60)}...`);
      log(`  Domain: ${atCookie.domain} | Length: ${atCookie.value.length} | JWT: ${atCookie.value.startsWith('eyJ')}`);
    } else {
      log("No access_token cookie found");
      cookies.filter(c => c.domain.includes('zo')).forEach(c => log(`  ${c.name} (${c.domain}) = ${(c.value||'').substring(0,30)}...`));
    }
  } catch(e) {
    log("Manual nav failed: " + e.message.substring(0, 80));
  }

  await browser.close();
  log("Done.");
}

main().catch(e => { console.error("Fatal:", e); process.exit(1); });
