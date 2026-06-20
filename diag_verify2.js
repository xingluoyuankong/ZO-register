const puppeteer = require("puppeteer-core");
const fs = require("fs");
const path = require("path");
const os = require("os");

const EXT_DIR = "E:\\API获取工具\\ZO注册\\turnstile-extension";
const EDGE_PATH = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
// Use the first email that already received a magic link
const EMAIL_FILE = "E:\\API获取工具\\批量注册邮箱\\已经使用\\8\\hendricktamm95v80awzaxli@outlook.com.txt";

async function main() {
  const content = fs.readFileSync(EMAIL_FILE, 'utf-8').trim();
  const [email, password, clientId, refreshToken] = content.split('----').map(s => s.trim());
  console.log("Email:", email);

  // Get Graph token
  const body = new URLSearchParams({
    client_id: clientId, grant_type: 'refresh_token', refresh_token: refreshToken,
    scope: 'https://graph.microsoft.com/.default offline_access',
  });
  const tokenResp = await fetch('https://login.microsoftonline.com/consumers/oauth2/v2.0/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString(),
  });
  const tokenData = await tokenResp.json();
  if (tokenData.error) { console.log("TOKEN ERR:", tokenData.error_description); return; }
  console.log("Graph token OK");

  // Find ZO magic link
  const mailResp = await fetch(
    'https://graph.microsoft.com/v1.0/me/messages?$top=10&$select=subject,body,from,receivedDateTime&$orderby=receivedDateTime%20desc',
    { headers: { Authorization: 'Bearer ' + tokenData.access_token } }
  );
  const mail = await mailResp.json();

  let magicLink = null;
  for (const msg of (mail.value || [])) {
    const fromAddr = msg.from?.emailAddress?.address || '';
    const combined = (msg.subject || '') + ' ' + (msg.body?.content || '');
    console.log("Email:", msg.receivedDateTime, "from:", fromAddr, "subj:", (msg.subject||'').substring(0,40));
    if (/zocomputer|zo\.computer/i.test(fromAddr + ' ' + combined)) {
      const links = combined.match(/https?:\/\/[^\s"'<>]*zo\.computer[^\s"'<>]*/gi) || [];
      console.log("  ZO links found:", links.length);
      for (let link of links) {
        link = link.replace(/[)\]>,;!?\s]+$/, "").replace(/&amp;/g, "&");
        console.log("  Link:", link.substring(0, 120));
        if (/token=|verify|login/i.test(link) && !magicLink) magicLink = link;
      }
    }
  }

  if (!magicLink) { console.log("No magic link found"); return; }
  console.log("\n=== Using link:", magicLink.substring(0, 100));

  // Launch browser
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "zo_diag_"));
  const browser = await puppeteer.launch({
    executablePath: EDGE_PATH, headless: false, protocolTimeout: 120000,
    userDataDir: tempDir,
    args: [
      "--no-first-run", "--no-default-browser-check", "--disable-default-apps",
      "--disable-features=Translate", "--disable-blink-features=AutomationControlled",
      "--window-size=1440,900", "--disk-cache-size=0",
      "--no-sandbox", "--disable-setuid-sandbox",
      "--load-extension=" + EXT_DIR,
    ],
    defaultViewport: { width: 1440, height: 900 },
    ignoreDefaultArgs: ["--enable-automation"],
  });

  const pages = await browser.pages();
  const page = pages[0] || await browser.newPage();

  // Capture ALL console
  page.on('console', msg => console.log("[CONSOLE]", msg.text().substring(0, 200)));
  page.on('pageerror', err => console.log("[PAGE_ERROR]", err.message.substring(0, 200)));
  page.on('requestfailed', req => console.log("[REQ_FAIL]", req.url().substring(0, 80), req.failure()?.errorText));

  // Track navigation
  page.on('framenavigated', frame => {
    if (frame === page.mainFrame()) {
      console.log("[NAV]", frame.url().substring(0, 100));
    }
  });

  // Navigate
  console.log("\n=== Opening magic link ===");
  try {
    await page.goto(magicLink, { waitUntil: "domcontentloaded", timeout: 60000 });
  } catch (e) {
    console.log("Nav error:", e.message.substring(0, 100));
  }

  // Screenshot immediately
  await page.screenshot({ path: "E:\\API获取工具\\ZO注册\\registered\\diag_0s.png" }).catch(() => {});

  // Wait and observe
  for (let i = 1; i <= 15; i++) {
    await new Promise(r => setTimeout(r, 3000));
    const url = page.url();
    const txt = await page.evaluate(() => document.body?.innerText?.substring(0, 400) || '').catch(() => '');
    console.log(`\n--- ${i*3}s ---`);
    console.log("URL:", url.substring(0, 100));
    console.log("Text:", txt.substring(0, 200).replace(/\n/g, ' | '));

    // Detailed page inspection
    const info = await page.evaluate(() => {
      const r = {};
      r.iframes = Array.from(document.querySelectorAll('iframe')).map(f => f.src?.substring(0, 80));
      try { r.turnstile = typeof turnstile !== 'undefined'; } catch(e) { r.turnstile = false; }
      try { const inp = document.querySelector('input[name="cf-turnstile-response"]'); r.tokenValue = inp?.value?.substring(0, 20) || null; } catch(e) {}
      const meta = document.querySelector('meta[http-equiv="refresh"]');
      r.metaRefresh = meta?.content || null;
      r.allLinks = Array.from(document.querySelectorAll('a[href]')).map(a => a.href.substring(0, 80)).filter(h => !h.startsWith('javascript:')).slice(0, 5);
      r.allButtons = Array.from(document.querySelectorAll('button')).map(b => b.textContent.trim().substring(0, 50)).slice(0, 5);
      r.forms = document.querySelectorAll('form').length;
      r.scripts = document.querySelectorAll('script').length;
      return r;
    }).catch(() => ({}));
    console.log("Info:", JSON.stringify(info, null, 0));

    // Screenshot at intervals
    if (i === 1 || i === 5 || i === 10) {
      await page.screenshot({ path: `E:\\API获取工具\\ZO注册\\registered\\diag_${i*3}s.png` }).catch(() => {});
    }

    if (/choose your handle/i.test(txt)) {
      console.log("\n✅ REACHED HANDLE PAGE!");
      break;
    }
  }

  // Dump HTML of verify page
  console.log("\n=== Page HTML (first 3000) ===");
  const html = await page.evaluate(() => document.documentElement.outerHTML.substring(0, 3000)).catch(() => '');
  console.log(html);

  await browser.close();
  try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch(e) {}
}

main().catch(e => console.log("FATAL:", e.message));
