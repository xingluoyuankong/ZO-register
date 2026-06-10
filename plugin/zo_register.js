/**
 * ZO Computer - Core Registration Logic
 * Modular plugin for batch email registration
 */
const puppeteer = require("puppeteer-core");
const { writeFileSync, appendFileSync, existsSync, mkdirSync } = require("fs");
const { join } = require("path");
const os = require("os");
const fs = require("fs");

// ========== Default Config ==========
const DEFAULT_CONFIG = {
  signupUrl: "https://www.zo.computer/signup",
  graphTokenUrl: "https://login.microsoftonline.com/consumers/oauth2/v2.0/token",
  graphMailUrl: "https://graph.microsoft.com/v1.0/me/messages",
  chromePath: "C:\\Users\\XZXyuan\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe",
  edgePath: "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  browserType: "edge", // edge | chrome
  registeredDir: null, // set by caller
};

// ========== Stealth Patches ==========
const STEALTH_JS = `
  Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  Object.defineProperty(navigator, 'plugins', {
    get: () => {
      const p = [
        { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
        { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai', description: '' },
        { name: 'Native Client', filename: 'internal-nacl-plugin', description: '' },
      ];
      p.length = 3;
      return p;
    }
  });
  Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
  Object.defineProperty(navigator, 'language', { get: () => 'en-US' });
  window.chrome = { runtime: {}, loadTimes: function(){}, csi: function(){} };
  delete window.cdc_adoQpoasnfa76pfcZLmcfl_Array;
  delete window.cdc_adoQpoasnfa76pfcZLmcfl_Promise;
  delete window.cdc_adoQpoasnfa76pfcZLmcfl_Symbol;
  const origQuery = window.navigator.permissions.query;
  window.navigator.permissions.query = (p) =>
    p.name === 'notifications' ? Promise.resolve({ state: Notification.permission }) : origQuery(p);
  Object.defineProperty(navigator, 'connection', { get: () => ({ rtt: 50, downlink: 10, effectiveType: '4g', saveData: false }) });
  Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8 });
  Object.defineProperty(navigator, 'deviceMemory', { get: () => 8 });
`;

// ========== Browser Launch ==========
async function launchBrowser(config, log) {
  const bt = config.browserType || DEFAULT_CONFIG.browserType;
  const tempDir = fs.mkdtempSync(join(os.tmpdir(), "zo_reg_"));
  const exePath = bt === "edge" ? config.edgePath || DEFAULT_CONFIG.edgePath : config.chromePath || DEFAULT_CONFIG.chromePath;
  const name = bt === "edge" ? "Edge" : "Chrome";

  const browser = await puppeteer.launch({
    executablePath: exePath,
    headless: false,
    protocolTimeout: 300000,
    userDataDir: tempDir,
    args: [
      "--no-first-run", "--no-default-browser-check", "--disable-default-apps",
      "--disable-features=Translate", "--disable-blink-features=AutomationControlled",
      "--window-size=1440,900", "--incognito", "--disk-cache-size=0",
      "--disable-save-password-bubble", "--disable-password-generation",
      "--password-store=basic", "--disable-sync",
      "--disable-client-side-phishing-detection", "--disable-background-networking",
      "--disable-background-timer-throttling", "--disable-backgrounding-occluded-windows",
      "--disable-renderer-backgrounding", "--disable-hang-monitor",
      "--disable-gpu", "--disable-software-rasterizer", "--disable-dev-shm-usage",
      "--no-sandbox", "--disable-setuid-sandbox", "--disable-component-update",
      "--metrics-recording-only", "--no-pings", "--disable-extensions",
      "--disable-plugins-discovery", "--disable-infobars",
    ],
    defaultViewport: { width: 1440, height: 900 },
    ignoreDefaultArgs: ["--enable-automation"],
  });

  // Apply stealth to all pages
  const pages = await browser.pages();
  const page = pages.length > 0 ? pages[0] : await browser.newPage();
  await page.evaluateOnNewDocument(STEALTH_JS);
  browser.on("targetcreated", async (t) => {
    const p = await t.page().catch(() => null);
    if (p) await p.evaluateOnNewDocument(STEALTH_JS);
  });

  log(`[BROWSER] ${name} launched, temp: ${tempDir}`);
  return { browser, page, tempDir };
}

// ========== Graph API: Get Mail Token ==========
async function getMailToken(clientId, refreshToken, config) {
  const body = new URLSearchParams({
    client_id: clientId,
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    scope: "https://graph.microsoft.com/.default offline_access",
  });
  const resp = await fetch(config.graphTokenUrl || DEFAULT_CONFIG.graphTokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  const data = await resp.json();
  if (data.error) throw new Error("Token error: " + data.error_description);
  return { accessToken: data.access_token, newRefreshToken: data.refresh_token || refreshToken };
}

// ========== Find Magic Link ==========
async function findMagicLink(accessToken, afterTime, log, config) {
  const url = (config.graphMailUrl || DEFAULT_CONFIG.graphMailUrl) + "?$top=10&$select=subject,body,from,receivedDateTime&$orderby=receivedDateTime%20desc";
  const resp = await fetch(url, { headers: { Authorization: "Bearer " + accessToken } });
  const mail = await resp.json();
  if (!mail.value || mail.value.length === 0) return null;

  for (const msg of mail.value) {
    const recvTime = new Date(msg.receivedDateTime);
    if (recvTime < afterTime) continue;

    const subject = msg.subject || "";
    const fromAddr = (msg.from?.emailAddress?.address) || "";
    const fromName = (msg.from?.emailAddress?.name) || "";
    const bodyContent = (msg.body?.content) || "";
    const combined = subject + " " + fromName + " " + fromAddr + " " + bodyContent;

    if (!/zo/i.test(combined)) continue;

    // Extract links from href attributes first, then raw URLs
    const hrefLinks = combined.match(/href=["']([^"']*zo\.computer[^"']*)["']/gi) || [];
    const rawLinks = combined.match(/https?:\/\/[^\s"'<>]*zo\.computer[^\s"'<>]*/gi) || [];
    const allZoLinks = [...hrefLinks.map(h => h.replace(/^href=["']/i, "").replace(/["']$/, "")), ...rawLinks];

    for (let link of allZoLinks) {
      link = link.replace(/[)\]>,;!?\s]+$/, "").replace(/&amp;/g, "&").replace(/&#38;/g, "&").replace(/&#61;/g, "=");
      if (/token=|verify|login|sign/i.test(link)) return link;
    }

    // Fallback: any link with token=
    const allLinks = combined.match(/https?:\/\/[^\s"'<>]+/gi) || [];
    for (let link of allLinks) {
      link = link.replace(/[)\]>,;!?\s]+$/, "").replace(/&amp;/g, "&").replace(/&#38;/g, "&").replace(/&#61;/g, "=");
      if (link.includes("token=") && link.includes("zo")) return link;
    }
  }
  return null;
}

// ========== Poll for Magic Link ==========
async function pollMagicLink(email, clientId, refreshToken, afterTime, log, config) {
  let rt = refreshToken;
  const deadline = Date.now() + 180000;
  while (Date.now() < deadline) {
    try {
      const { accessToken, newRefreshToken } = await getMailToken(clientId, rt, config);
      rt = newRefreshToken;
      const link = await findMagicLink(accessToken, afterTime, log, config);
      if (link) return { link, newRefreshToken: rt };
    } catch (e) { log("Poll error: " + e.message); }
    process.stdout.write(".");
    await new Promise(r => setTimeout(r, 3000));
  }
  return null;
}

// ========== Safe Page Helpers ==========
async function getBodyText(page, len) {
  len = len || 500;
  try { return await page.evaluate((l) => document.body.innerText.substring(0, l), len); } catch (e) { return ""; }
}

async function waitForText(page, regex, timeoutMs) {
  timeoutMs = timeoutMs || 30000;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const txt = await getBodyText(page);
    if (regex.test(txt)) return txt;
    await new Promise(r => setTimeout(r, 2000));
  }
  return null;
}

// ========== Register One Email ==========
async function registerOne(emailItem, config, log) {
  const { email, password, clientId, refreshToken } = emailItem;
  const registeredDir = config.registeredDir;
  let browser, tempDir;

  try {
    // Launch browser
    const launched = await launchBrowser(config, log);
    browser = launched.browser;
    tempDir = launched.tempDir;
    const page = launched.page;
    page.setDefaultTimeout(60000);
    await page.setViewport({ width: 1440, height: 900 });

    // Step 1: Open signup
    log("[1/7] Opening signup...");
    await page.goto(config.signupUrl || DEFAULT_CONFIG.signupUrl, { waitUntil: "domcontentloaded", timeout: 45000 });
    await new Promise(r => setTimeout(r, 2000));
    const signupReady = await waitForText(page, /sign\s*up|email\s*me|continue/i, 30000);
    if (!signupReady) throw new Error("Signup page did not load");

    // Step 2: Click "Email me a sign-up link"
    log("[2/7] Clicking email button...");
    let clicked = false;
    for (let attempt = 0; attempt < 3 && !clicked; attempt++) {
      for (const sel of ["button", "a", "div[role=button]"]) {
        const els = await page.$$(sel);
        for (const el of els) {
          const txt = await el.evaluate(e => e.textContent).catch(() => "");
          if (/Email me a sign-up link/i.test(txt)) { await el.click(); clicked = true; break; }
        }
        if (clicked) break;
      }
      if (!clicked) await new Promise(r => setTimeout(r, 2000));
    }
    if (!clicked) throw new Error("Cannot find 'Email me a sign-up link' button");
    await new Promise(r => setTimeout(r, 2000));

    // Step 3: Fill email + Continue
    log("[3/7] Filling email: " + email);
    let emailInput = null;
    for (let i = 0; i < 15; i++) {
      emailInput = await page.$("input[type=email], input#email, input[name=email]");
      if (!emailInput) {
        const allInputs = await page.$$("input");
        for (const inp of allInputs) {
          const ph = await inp.evaluate(e => (e.placeholder || "") + " " + (e.type || "")).catch(() => "");
          if (/email/i.test(ph)) { emailInput = inp; break; }
        }
      }
      if (emailInput) break;
      await new Promise(r => setTimeout(r, 2000));
    }
    if (!emailInput) throw new Error("Email input not found");

    await emailInput.click({ clickCount: 3 });
    await new Promise(r => setTimeout(r, 200));
    await emailInput.type(email, { delay: 30 });
    await new Promise(r => setTimeout(r, 500));

    // Verify input value
    const typedValue = await emailInput.evaluate(e => e.value).catch(() => "");
    if (typedValue !== email) {
      log("  Input value mismatch, using setter...");
      await page.evaluate((val) => {
        const inp = document.querySelector("input[type=email]") || document.querySelector("input#email") || document.querySelector("input[name=email]");
        if (!inp) return;
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
        setter.call(inp, val);
        inp.dispatchEvent(new Event("input", { bubbles: true }));
        inp.dispatchEvent(new Event("change", { bubbles: true }));
      }, email);
      await new Promise(r => setTimeout(r, 500));
    }

    // Click Continue
    const btns = await page.$$("button");
    for (const btn of btns) {
      const txt = await btn.evaluate(e => e.textContent.trim()).catch(() => "");
      if (/^Continue$/i.test(txt)) { await btn.click(); break; }
    }
    await new Promise(r => setTimeout(r, 4000));

    // Verify email was sent
    const pageText = await getBodyText(page, 400);
    log("  After continue: " + pageText.substring(0, 80));
    if (!/check your email|login link|we sent/i.test(pageText)) {
      if (/continue|back/i.test(pageText) && !/check/i.test(pageText)) {
        log("  Page still shows form, retrying Continue...");
        const retryBtns = await page.$$("button");
        for (const btn of retryBtns) {
          const txt = await btn.evaluate(e => e.textContent.trim()).catch(() => "");
          if (/^Continue$/i.test(txt)) { await btn.click(); break; }
        }
        await new Promise(r => setTimeout(r, 4000));
        const retryText = await getBodyText(page, 300);
        if (!/check your email|login link|we sent/i.test(retryText)) {
          throw new Error("Email send failed: " + retryText.substring(0, 60));
        }
      } else {
        throw new Error("Email send failed: " + pageText.substring(0, 60));
      }
    }

    const sendTime = new Date(Date.now() - 3000);
    log("[4/7] Email sent! Polling inbox...");

    // Step 4: Poll for magic link
    const result = await pollMagicLink(email, clientId, refreshToken, sendTime, log, config);
    if (!result) throw new Error("No magic link in 3 min");
    const { link, newRefreshToken } = result;
    log("  Got magic link!");

    // Update refresh token if changed
    if (newRefreshToken !== refreshToken && config.emailDir) {
      const tokenFile = join(config.emailDir, email + ".txt");
      if (existsSync(tokenFile)) {
        writeFileSync(tokenFile, [email, password, clientId, newRefreshToken].join("----"), "utf-8");
      }
    }

    // Step 5: Open magic link
    log("[5/7] Opening magic link...");
    log("  Link: " + link.substring(0, 80));

    // Clear cookies/cache for clean request
    const cdpSession = await page.target().createCDPSession();
    try { await cdpSession.send("Network.clearBrowserCookies"); } catch (e) {}
    try { await cdpSession.send("Network.clearBrowserCache"); } catch (e) {}
    try { await cdpSession.detach(); } catch (e) {}

    try {
      await page.goto(link, { waitUntil: "networkidle2", timeout: 60000 });
    } catch (navErr) {
      if (/timeout/i.test(navErr.message)) {
        log("  Navigation timeout, continuing...");
      } else if (/net::ERR_/i.test(navErr.message)) {
        throw new Error("Network error opening link: " + navErr.message);
      } else {
        log("  Nav error: " + navErr.message + ", continuing...");
      }
    }
    await new Promise(r => setTimeout(r, 2000));

    // Step 5b: Wait for Turnstile/redirect → handle page
    log("  Waiting for Turnstile/redirect...");
    let reachedHandlePage = false;
    let clickedContinueOnce = false;
    let seenRedirecting = false;
    const startUrl = page.url();

    for (let i = 0; i < 60; i++) {
      const txt = await getBodyText(page, 600);
      const currentUrl = page.url();

      if (/choose your handle/i.test(txt) || (currentUrl.includes("/signup") && /handle/i.test(txt))) {
        log("  Reached handle page!");
        reachedHandlePage = true;
        break;
      }

      if (/invalid|expired/i.test(txt) && !/redirecting|verif/i.test(txt)) {
        throw new Error("Link expired after click");
      }

      // Wait for redirect after clicking Continue
      if (clickedContinueOnce && seenRedirecting) {
        if (currentUrl !== startUrl && !currentUrl.includes("email-login/verify")) {
          log("  URL changed to: " + currentUrl);
          await new Promise(r => setTimeout(r, 3000));
          const afterRedirect = await getBodyText(page, 400);
          if (/choose your handle/i.test(afterRedirect)) {
            log("  Reached handle page after redirect!");
            reachedHandlePage = true;
            break;
          }
          seenRedirecting = false;
          continue;
        }
        if (/redirecting/i.test(txt)) {
          if (i % 5 === 0) log("  [" + i * 3 + "s] Waiting for redirect...");
          await new Promise(r => setTimeout(r, 3000));
          continue;
        }
      }

      // Click "Continue in browser"
      if (!clickedContinueOnce) {
        const clickedContinue = await page.evaluate(() => {
          for (const el of document.querySelectorAll("button, a, div[role=button], span")) {
            if (/Continue in browser/i.test(el.textContent.trim()) && el.offsetParent !== null) {
              el.click();
              return true;
            }
          }
          return false;
        }).catch(() => false);

        if (clickedContinue) {
          log("  Clicked 'Continue in browser'");
          clickedContinueOnce = true;
          await new Promise(r => setTimeout(r, 5000));
          const afterTxt = await getBodyText(page, 300);
          if (/choose your handle/i.test(afterTxt)) { reachedHandlePage = true; break; }
          if (/redirecting/i.test(afterTxt)) { seenRedirecting = true; log("  Page redirecting..."); }
          continue;
        }
      }

      if (/redirecting/i.test(txt)) { seenRedirecting = true; await new Promise(r => setTimeout(r, 3000)); continue; }
      await new Promise(r => setTimeout(r, 3000));
    }

    if (!reachedHandlePage) {
      const finalTxt = await getBodyText(page, 300);
      if (/choose your handle/i.test(finalTxt)) { reachedHandlePage = true; }
      else throw new Error("Failed to reach handle page: " + finalTxt.substring(0, 80));
    }

    // Step 6: Choose handle
    log("[6/7] Setting handle...");
    let handleInput = null;
    for (let i = 0; i < 20; i++) {
      handleInput = await page.$("input[placeholder='you']");
      if (!handleInput) handleInput = await page.$("input[type=text]");
      if (!handleInput) handleInput = await page.$("input:not([type=hidden]):not([type=submit])");
      if (handleInput) break;
      await new Promise(r => setTimeout(r, 2000));
    }
    if (!handleInput) throw new Error("Handle input not found");

    const handle = "user" + Math.random().toString(36).substring(2, 8);
    log("  Handle: " + handle);
    await handleInput.click({ clickCount: 3 });
    await new Promise(r => setTimeout(r, 200));
    await handleInput.type(handle, { delay: 30 });
    await new Promise(r => setTimeout(r, 1000));

    const handleBtns = await page.$$("button");
    for (const btn of handleBtns) {
      const txt = await btn.evaluate(e => e.textContent.trim()).catch(() => "");
      if (/^Continue$/i.test(txt)) { await btn.click(); break; }
    }
    await new Promise(r => setTimeout(r, 5000));

    // Step 7: Boot → Go to your Zo
    log("[7/7] Waiting for boot...");
    for (let i = 1; i <= 50; i++) {
      await new Promise(r => setTimeout(r, 5000));
      const txt = await getBodyText(page, 400);
      if (/go to your zo/i.test(txt)) {
        log("  Boot complete! Clicking 'Go to your Zo'...");
        await page.evaluate(() => {
          for (const el of document.querySelectorAll("button, a, div[role=button]")) {
            if (/go to your zo/i.test(el.textContent.trim())) { el.click(); return; }
          }
        });
        await new Promise(r => setTimeout(r, 8000));
        const finalUrl = page.url();
        log("  SUCCESS! URL: " + finalUrl);

        // Move file to registered dir
        if (registeredDir && config.emailDir) {
          try {
            const src = join(config.emailDir, email + ".txt");
            const dst = join(registeredDir, email + ".txt");
            if (existsSync(src)) fs.renameSync(src, dst);
          } catch (e) {}
        }

        return { handle, zoAddress: handle + ".zo.computer", url: finalUrl };
      }
      if (/invalid|expired|something went wrong/i.test(txt) && !/booting|starting|%/i.test(txt)) {
        throw new Error("Boot failed: " + txt.substring(0, 60));
      }
      const pct = txt.match(/(\d+\.?\d*)%/);
      if (pct && i % 3 === 0) log("  Boot: " + pct[1] + "%");
    }
    throw new Error("Boot timeout (250s)");

  } finally {
    if (browser) {
      try { await browser.close(); } catch (e) {}
      if (tempDir) try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch (e) {}
      log("[BROWSER] Cleaned up");
    }
  }
}

module.exports = { registerOne, launchBrowser, getMailToken, findMagicLink, pollMagicLink, DEFAULT_CONFIG };
