const puppeteer = require("puppeteer-core");
const fs = require("fs");
const path = require("path");
const os = require("os");

const EMAIL_DIR = "E:\\API获取工具\\批量注册邮箱\\已经使用\\8";
const EXT_DIR = "E:\\API获取工具\\ZO注册\\turnstile-extension";
const EDGE_PATH = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";

async function main() {
  // Get email file (second file since first was used)
  const files = fs.readdirSync(EMAIL_DIR).filter(f => f.endsWith('.txt'));
  const file = files[1]; // Use second file
  const content = fs.readFileSync(path.join(EMAIL_DIR, file), 'utf-8').trim();
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

  // Find magic link
  const mailResp = await fetch(
    'https://graph.microsoft.com/v1.0/me/messages?$top=5&$select=subject,body,from,receivedDateTime&$orderby=receivedDateTime%20desc',
    { headers: { Authorization: 'Bearer ' + tokenData.access_token } }
  );
  const mail = await mailResp.json();

  let magicLink = null;
  for (const msg of (mail.value || [])) {
    const fromAddr = msg.from?.emailAddress?.address || '';
    const combined = (msg.subject || '') + ' ' + (msg.body?.content || '');
    if (/zocomputer|zo\.computer/i.test(fromAddr + ' ' + combined)) {
      const links = combined.match(/https?:\/\/[^\s"'<>]*zo\.computer[^\s"'<>]*/gi) || [];
      for (let link of links) {
        link = link.replace(/[)\]>,;!?\s]+$/, "").replace(/&amp;/g, "&");
        if (/token=|verify|login/i.test(link)) { magicLink = link; break; }
      }
      if (magicLink) break;
    }
  }

  if (!magicLink) { console.log("No magic link found in inbox"); return; }
  console.log("Magic link:", magicLink.substring(0, 100));

  // Launch browser with extension
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

  // Capture console messages
  page.on('console', msg => {
    if (msg.type() === 'error' || msg.type() === 'warning') {
      console.log("[CONSOLE " + msg.type() + "]", msg.text());
    }
  });

  // Capture page errors
  page.on('pageerror', err => console.log("[PAGE_ERROR]", err.message));

  // Capture failed requests
  page.on('requestfailed', req => {
    console.log("[REQ_FAIL]", req.url().substring(0, 80), req.failure()?.errorText);
  });

  // Navigate to magic link
  console.log("\n=== Opening magic link ===");
  try {
    await page.goto(magicLink, { waitUntil: "domcontentloaded", timeout: 60000 });
  } catch (e) {
    console.log("Nav error:", e.message.substring(0, 80));
  }

  // Wait and observe
  for (let i = 0; i < 20; i++) {
    await new Promise(r => setTimeout(r, 3000));
    const url = page.url();
    const txt = await page.evaluate(() => document.body?.innerText?.substring(0, 300) || '').catch(() => '');

    console.log(`\n[${(i+1)*3}s] URL: ${url.substring(0, 80)}`);
    console.log(`[${(i+1)*3}s] Text: ${txt.substring(0, 150).replace(/\n/g, ' | ')}`);

    // Check for Turnstile
    const tsInfo = await page.evaluate(() => {
      const iframes = document.querySelectorAll('iframe');
      const result = { iframeCount: iframes.length, iframeSrcs: [], turnstileObj: false, tokenInput: false };
      for (const iframe of iframes) {
        result.iframeSrcs.push((iframe.src || '').substring(0, 80));
      }
      try { if (typeof turnstile !== 'undefined') result.turnstileObj = true; } catch(e) {}
      try {
        const inp = document.querySelector('input[name="cf-turnstile-response"]');
        if (inp) result.tokenInput = !!inp.value;
      } catch(e) {}
      // Check meta refresh
      const meta = document.querySelector('meta[http-equiv="refresh"]');
      if (meta) result.metaRefresh = meta.content;
      // Check for redirect scripts
      const scripts = document.querySelectorAll('script');
      result.scriptCount = scripts.length;
      // Check window.location changes
      result.currentHref = window.location.href;
      return result;
    }).catch(() => ({}));
    console.log(`[${(i+1)*3}s] Info:`, JSON.stringify(tsInfo));

    if (/choose your handle/i.test(txt)) {
      console.log("\n✅ REACHED HANDLE PAGE!");
      break;
    }

    // Take screenshot at key moments
    if (i === 0 || i === 5 || i === 10) {
      const ssPath = `E:\\API获取工具\\ZO注册\\registered\\diag_${i*3}s.png`;
      await page.screenshot({ path: ssPath }).catch(() => {});
      console.log(`  Screenshot: ${ssPath}`);
    }
  }

  // Final page source dump
  console.log("\n=== Final page HTML (first 2000 chars) ===");
  const html = await page.evaluate(() => document.documentElement.outerHTML.substring(0, 2000)).catch(() => '');
  console.log(html);

  await browser.close();
  try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch(e) {}
}

main().catch(e => console.log("FATAL:", e.message));
