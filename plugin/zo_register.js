/**
 * ZO Computer - Core Registration Logic
 * Modular plugin for batch email registration
 */
const puppeteer = require("puppeteer-core");
const { writeFileSync, readFileSync, appendFileSync, existsSync, mkdirSync } = require("fs");
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

  // Resolve Turnstile extension path
  const extDir = config.turnstileExtDir || join(__dirname, "..", "turnstile-extension");
  const extExists = existsSync(join(extDir, "manifest.json"));

  const launchArgs = [
    "--no-first-run", "--no-default-browser-check", "--disable-default-apps",
    "--disable-features=Translate", "--disable-blink-features=AutomationControlled",
    "--window-size=1440,900", "--disk-cache-size=0",
    "--disable-save-password-bubble", "--disable-password-generation",
    "--password-store=basic", "--disable-sync",
    "--disable-client-side-phishing-detection", "--disable-background-networking",
    "--disable-background-timer-throttling", "--disable-backgrounding-occluded-windows",
    "--disable-renderer-backgrounding", "--disable-hang-monitor",
    "--disable-gpu", "--disable-software-rasterizer", "--disable-dev-shm-usage",
    "--no-sandbox", "--disable-setuid-sandbox", "--disable-component-update",
    "--metrics-recording-only", "--no-pings",
    "--disable-plugins-discovery", "--disable-infobars",
  ];

  // ★ Load Turnstile bypass extension (world:MAIN, all_frames:true)
  if (extExists) {
    launchArgs.push("--load-extension=" + extDir);
    log("[BROWSER] Turnstile extension loaded from: " + extDir);
  } else {
    log("[BROWSER] ⚠️ Turnstile extension NOT found at: " + extDir);
  }

  const browser = await puppeteer.launch({
    executablePath: exePath,
    headless: false,
    protocolTimeout: 300000,
    userDataDir: tempDir,
    args: launchArgs,
    defaultViewport: { width: 1440, height: 900 },
    ignoreDefaultArgs: ["--enable-automation"],
  });

  // ★ Stealth handled entirely by turnstile-extension (world:MAIN, all_frames:true)
  // ★ NO evaluateOnNewDocument — it conflicts with extension patches
  const pages = await browser.pages();
  const page = pages.length > 0 ? pages[0] : await browser.newPage();

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
  // Use receivedDateTime filter to only get recent emails (reduces noise)
  const filterTime = new Date(afterTime.getTime() - 60000).toISOString();
  const url = (config.graphMailUrl || DEFAULT_CONFIG.graphMailUrl)
    + "?$top=10&$select=subject,body,from,receivedDateTime"
    + "&$filter=receivedDateTime ge " + encodeURIComponent(filterTime)
    + "&$orderby=receivedDateTime%20desc";
  const resp = await fetch(url, { headers: { Authorization: "Bearer " + accessToken } });
  const mail = await resp.json();
  if (!mail.value || mail.value.value?.length === 0 && mail.value.length === 0) return null;
  const messages = mail.value || [];

  for (const msg of messages) {
    const recvTime = new Date(msg.receivedDateTime);
    if (recvTime < afterTime) continue;

    const subject = msg.subject || "";
    const fromAddr = (msg.from?.emailAddress?.address) || "";
    const fromName = (msg.from?.emailAddress?.name) || "";
    const bodyContent = (msg.body?.content) || "";
    const combined = subject + " " + fromName + " " + fromAddr + " " + bodyContent;

    // ===== Precise ZO email detection =====
    // Check sender domain first (most reliable)
    const isZoSender = /zo\.computer|zo\.email|@zo\./i.test(fromAddr) || /\bzo\b/i.test(fromName);
    // Check for zo.computer references in body/subject (not just "zo" substring)
    const isZoContent = /zo\.computer|zo computer|\bzo\b.*(?:sign|login|verify|magic|link|email)/i.test(combined);
    // Direct link check (most reliable)
    const hasZoLink = /zo\.computer/i.test(combined);

    if (!isZoSender && !isZoContent && !hasZoLink) continue;

    log("  [MAIL] Found candidate: \"" + subject.substring(0, 50) + "\" from " + fromAddr);

    // Extract links from href attributes first, then raw URLs
    const hrefLinks = combined.match(/href=["']([^"']*zo\.computer[^"']*)["']/gi) || [];
    const rawLinks = combined.match(/https?:\/\/[^\s"'<>]*zo\.computer[^\s"'<>]*/gi) || [];
    const allZoLinks = [...hrefLinks.map(h => h.replace(/^href=["']/i, "").replace(/["']$/, "")), ...rawLinks];

    for (let link of allZoLinks) {
      link = link.replace(/[)\]>,;!?\s]+$/, "").replace(/&amp;/g, "&").replace(/&#38;/g, "&").replace(/&#61;/g, "=");
      if (/token=|verify|login|sign|email-login/i.test(link)) {
        log("  [MAIL] ✅ ZO link found!");
        return link;
      }
    }

    // Fallback: any link with token= that looks like a verification link
    const allLinks = combined.match(/https?:\/\/[^\s"'<>]+/gi) || [];
    for (let link of allLinks) {
      link = link.replace(/[)\]>,;!?\s]+$/, "").replace(/&amp;/g, "&").replace(/&#38;/g, "&").replace(/&#61;/g, "=");
      if (link.includes("token=") && (link.includes("zo") || link.includes("verify"))) {
        log("  [MAIL] ✅ Token link found (fallback)!");
        return link;
      }
    }

    // If we identified this as a ZO email but no link found, log it
    if (hasZoLink) {
      log("  [MAIL] ⚠️ ZO email detected but no usable link found");
      log("  [MAIL] Body snippet: " + bodyContent.substring(0, 200).replace(/<[^>]+>/g, ""));
    }
  }
  return null;
}

// ========== Poll for Magic Link ==========
async function pollMagicLink(email, clientId, refreshToken, afterTime, log, config) {
  let rt = refreshToken;
  const deadline = Date.now() + 180000;
  let pollCount = 0;
  log("[POLL] Started, deadline: " + new Date(deadline).toLocaleTimeString());
  while (Date.now() < deadline) {
    pollCount++;
    try {
      const { accessToken, newRefreshToken } = await getMailToken(clientId, rt, config);
      rt = newRefreshToken;
      const link = await findMagicLink(accessToken, afterTime, log, config);
      if (link) {
        log("[POLL] ✅ Link found after " + pollCount + " polls");
        return { link, newRefreshToken: rt };
      }
    } catch (e) {
      log("[POLL] Error: " + e.message.substring(0, 100));
    }
    if (pollCount % 5 === 0) {
      const remaining = Math.round((deadline - Date.now()) / 1000);
      log("[POLL] Poll #" + pollCount + ", " + remaining + "s remaining");
    }
    process.stdout.write(".");
    await new Promise(r => setTimeout(r, 3000));
  }
  log("[POLL] ⚠️ Timeout after " + pollCount + " polls");
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

// ========== Fetch Access Token ==========
async function fetchAccessToken(page, config, log) {
  log("[TOKEN] Starting Access Token retrieval...");
  const currentUrl = page.url();
  const zoBase = currentUrl.match(/https?:\/\/[^\/]+/)?.[0] || "";
  const settingsUrls = [
    zoBase + "/settings",
    zoBase + "/setting",
    "https://www.zo.computer/settings",
  ];

  // Step T1: Navigate to settings page
  log("[TOKEN] Looking for settings page...");
  let settingsLoaded = false;
  for (const sUrl of settingsUrls) {
    try {
      log("[TOKEN] Trying: " + sUrl);
      await page.goto(sUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
      await new Promise(r => setTimeout(r, 3000));
      const txt = await getBodyText(page, 800);
      // Check if we reached a settings page (look for settings-like content)
      if (/setting|advanced|profile|account|general/i.test(txt)) {
        log("[TOKEN] Settings page loaded!");
        settingsLoaded = true;
        break;
      }
    } catch (e) {
      log("[TOKEN] Nav error: " + e.message.substring(0, 50));
    }
  }

  // Fallback: try clicking settings gear/icon in UI
  if (!settingsLoaded) {
    log("[TOKEN] Trying to find settings link in UI...");
    const clicked = await page.evaluate(() => {
      // Look for settings gear icon or settings link
      for (const el of document.querySelectorAll('a, button, [role="button"], [aria-label*="settings" i], [aria-label*="Settings"]')) {
        const txt = (el.textContent || "").trim();
        const ariaLabel = (el.getAttribute("aria-label") || "").trim();
        const href = el.getAttribute("href") || "";
        if (/setting/i.test(txt) || /setting/i.test(ariaLabel) || /setting/i.test(href)) {
          el.click();
          return true;
        }
      }
      // Look for gear icon (⚙️ or SVG gear)
      for (const el of document.querySelectorAll('[class*="gear"], [class*="setting"], svg[class*="cog"]')) {
        el.click();
        return true;
      }
      return false;
    }).catch(() => false);
    if (clicked) {
      await new Promise(r => setTimeout(r, 3000));
      const txt = await getBodyText(page, 600);
      if (/setting|advanced|profile|account/i.test(txt)) {
        settingsLoaded = true;
        log("[TOKEN] Settings opened via UI click!");
      }
    }
  }

  if (!settingsLoaded) {
    log("[TOKEN] ⚠️ Could not find settings page, skipping token retrieval");
    return null;
  }

  // Step T2: Click "Advanced" tab
  log("[TOKEN] Clicking Advanced tab...");
  let advancedClicked = false;
  for (let attempt = 0; attempt < 3 && !advancedClicked; attempt++) {
    advancedClicked = await page.evaluate(() => {
      const selectors = [
        'a', 'button', '[role="tab"]', '[role="button"]', 'div[class*="tab"]', 'li', 'span'
      ];
      for (const sel of selectors) {
        for (const el of document.querySelectorAll(sel)) {
          const txt = (el.textContent || "").trim();
          if (/^Advanced$/i.test(txt) || /高级/i.test(txt)) {
            el.click();
            return true;
          }
        }
      }
      return false;
    }).catch(() => false);
    if (advancedClicked) {
      log("[TOKEN] Advanced tab clicked!");
      await new Promise(r => setTimeout(r, 3000));
      break;
    }
    await new Promise(r => setTimeout(r, 2000));
  }

  if (!advancedClicked) {
    log("[TOKEN] ⚠️ Could not find Advanced tab, trying to find token section directly...");
  }

  // Step T3: Find "Key name" input in Personal Access Tokens section
  log("[TOKEN] Looking for Access Token input...");
  let tokenInput = null;
  for (let i = 0; i < 15; i++) {
    tokenInput = await page.evaluate(() => {
      // Look for input near "Key name" or "Personal Access Token" text
      const allInputs = document.querySelectorAll('input[type="text"], input:not([type])');
      for (const inp of allInputs) {
        const ph = (inp.placeholder || "").toLowerCase();
        const ariaLabel = (inp.getAttribute("aria-label") || "").toLowerCase();
        const name = (inp.name || "").toLowerCase();
        // Check placeholder/aria-label
        if (/key.?name|token.?name|api.?key|name/i.test(ph) || /key.?name|token.?name/i.test(ariaLabel)) {
          return { found: true, selector: null };
        }
        // Check nearby label text
        const parent = inp.closest('div, label, section, fieldset');
        if (parent) {
          const parentText = (parent.textContent || "").toLowerCase();
          if (/key.?name|token.?name|personal.?access/i.test(parentText)) {
            return { found: true, selector: null };
          }
        }
      }
      // Also check if the page has "Personal Access Tokens" section visible
      const bodyText = document.body.innerText;
      if (/personal.?access.?token|api.?token|key.?name/i.test(bodyText)) {
        return { found: true, sectionVisible: true };
      }
      return { found: false };
    }).catch(() => ({ found: false }));

    if (tokenInput.found) break;
    await new Promise(r => setTimeout(r, 2000));
  }

  // Step T4: Type key name into the input
  const keyName = config.tokenKeyName || "API Access";
  log("[TOKEN] Entering key name: " + keyName);

  let keyNameFilled = false;
  // Try multiple approaches to find and fill the input
  for (let attempt = 0; attempt < 5 && !keyNameFilled; attempt++) {
    keyNameFilled = await page.evaluate((kn) => {
      // Approach 1: Find input by placeholder
      const allInputs = document.querySelectorAll('input[type="text"], input:not([type]), input[placeholder]');
      for (const inp of allInputs) {
        const ph = (inp.placeholder || "").toLowerCase();
        const ariaLabel = (inp.getAttribute("aria-label") || "").toLowerCase();
        const name = (inp.name || "").toLowerCase();
        const parent = inp.closest('div, label, section');
        const parentText = parent ? (parent.textContent || "").toLowerCase() : "";

        if (/key.?name|token.?name|name|api|key/i.test(ph) ||
            /key.?name|token.?name/i.test(ariaLabel) ||
            /key.?name|token.?name|personal.?access/i.test(parentText)) {
          // Use native setter to trigger React/Vue state updates
          const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
          inp.focus();
          setter.call(inp, kn);
          inp.dispatchEvent(new Event("input", { bubbles: true }));
          inp.dispatchEvent(new Event("change", { bubbles: true }));
          return true;
        }
      }

      // Approach 2: Find the first visible text input in the Advanced section
      const advancedSection = document.querySelector('[class*="advanced"], [data-tab*="advanced"], section');
      if (advancedSection) {
        const inp = advancedSection.querySelector('input[type="text"], input:not([type])');
        if (inp && inp.offsetParent !== null) {
          const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
          inp.focus();
          setter.call(inp, kn);
          inp.dispatchEvent(new Event("input", { bubbles: true }));
          inp.dispatchEvent(new Event("change", { bubbles: true }));
          return true;
        }
      }
      return false;
    }, keyName).catch(() => false);

    if (!keyNameFilled) {
      // Try puppeteer-level input finding
      const inputs = await page.$$('input[type="text"], input:not([type="hidden"]):not([type="submit"]):not([type="checkbox"]):not([type="radio"])');
      for (const inp of inputs) {
        const ph = await inp.evaluate(e => (e.placeholder || "") + "|" + (e.getAttribute("aria-label") || "")).catch(() => "");
        const parent = await inp.evaluate(e => {
          const p = e.closest('div, label, section');
          return p ? p.textContent.substring(0, 100) : "";
        }).catch(() => "");
        if (/key.?name|token.?name|name|api/i.test(ph + "|" + parent)) {
          await inp.click({ clickCount: 3 });
          await new Promise(r => setTimeout(r, 200));
          await inp.type(keyName, { delay: 30 });
          keyNameFilled = true;
          break;
        }
      }
    }
    if (!keyNameFilled) await new Promise(r => setTimeout(r, 2000));
  }

  if (!keyNameFilled) {
    log("[TOKEN] ⚠️ Could not find key name input, trying puppeteer type on first visible input...");
    // Last resort: try typing into first visible text input
    const visInputs = await page.$$('input');
    for (const inp of visInputs) {
      const visible = await inp.evaluate(e => e.offsetParent !== null && e.type !== 'hidden').catch(() => false);
      if (visible) {
        await inp.click({ clickCount: 3 });
        await new Promise(r => setTimeout(r, 200));
        await inp.type(keyName, { delay: 30 });
        keyNameFilled = true;
        log("[TOKEN] Filled first visible input as fallback");
        break;
      }
    }
  }

  if (!keyNameFilled) {
    log("[TOKEN] ⚠️ Failed to fill key name input");
    return null;
  }
  await new Promise(r => setTimeout(r, 1000));

  // Step T5: Click "Add" button
  log("[TOKEN] Clicking Add button...");
  let addClicked = false;
  for (let attempt = 0; attempt < 5 && !addClicked; attempt++) {
    addClicked = await page.evaluate(() => {
      const btns = document.querySelectorAll('button, [role="button"], input[type="submit"]');
      for (const btn of btns) {
        const txt = (btn.textContent || btn.value || "").trim();
        if (/^Add$/i.test(txt) || /^Create$/i.test(txt) || /^Generate$/i.test(txt) || /添加|创建|生成/.test(txt)) {
          btn.click();
          return true;
        }
      }
      return false;
    }).catch(() => false);

    if (!addClicked) {
      // Try puppeteer level
      const btns = await page.$$('button');
      for (const btn of btns) {
        const txt = await btn.evaluate(e => e.textContent.trim()).catch(() => "");
        if (/^Add$/i.test(txt) || /^Create$/i.test(txt) || /^Generate$/i.test(txt)) {
          await btn.click();
          addClicked = true;
          break;
        }
      }
    }
    if (addClicked) {
      log("[TOKEN] Add button clicked!");
      break;
    }
    await new Promise(r => setTimeout(r, 2000));
  }

  if (!addClicked) {
    log("[TOKEN] ⚠️ Could not find Add button");
    return null;
  }

  // Step T6: Wait for token to appear and copy it
  log("[TOKEN] Waiting for token to be generated...");
  await new Promise(r => setTimeout(r, 3000));

  let accessToken = null;
  for (let i = 0; i < 20; i++) {
    // Look for token in various formats
    accessToken = await page.evaluate(() => {
      // Check for code/pre elements that might contain the token
      for (const el of document.querySelectorAll('code, pre, [class*="token"], [class*="key"], [class*="secret"], [class*="copy"]')) {
        const txt = (el.textContent || "").trim();
        // Tokens are usually long strings (32+ chars), might start with specific prefix
        if (txt.length >= 20 && /^[A-Za-z0-9_\-./+=]+$/.test(txt)) {
          return txt;
        }
      }

      // Check for input/textarea with token value (readonly)
      for (const el of document.querySelectorAll('input[readonly], textarea[readonly], input[type="text"]')) {
        const val = (el.value || "").trim();
        if (val.length >= 20 && /^[A-Za-z0-9_\-./+=]+$/.test(val)) {
          return val;
        }
      }

      // Check for newly appeared text that looks like a token
      const bodyText = document.body.innerText;
      // Match patterns like: sk-xxx, zo_xxx, or any long alphanumeric string after "token"/"key" text
      const tokenPatterns = [
        /(?:token|key|secret)[:\s]+([A-Za-z0-9_\-./+=]{20,})/i,
        /\b(zo_[A-Za-z0-9_\-]{20,})\b/,
        /\b(sk_[A-Za-z0-9_\-]{20,})\b/,
      ];
      for (const pat of tokenPatterns) {
        const match = bodyText.match(pat);
        if (match) return match[1];
      }

      // Check for copy button's data attribute or sibling
      for (const btn of document.querySelectorAll('[class*="copy"], button')) {
        const txt = (btn.textContent || "").trim();
        if (/copy|复制/i.test(txt)) {
          const sibling = btn.previousElementSibling || btn.parentElement?.querySelector('code, pre, input, span[class*="token"]');
          if (sibling) {
            const val = (sibling.textContent || sibling.value || "").trim();
            if (val.length >= 20) return val;
          }
        }
      }

      return null;
    }).catch(() => null);

    if (accessToken) {
      log("[TOKEN] ✅ Access Token retrieved! (length: " + accessToken.length + ")");
      // Also try clicking copy button for convenience
      await page.evaluate(() => {
        for (const btn of document.querySelectorAll('[class*="copy"], button')) {
          const txt = (btn.textContent || "").trim();
          if (/copy|复制/i.test(txt)) { btn.click(); return; }
        }
      }).catch(() => {});
      return accessToken;
    }

    // Also try to get token from a dialog/modal that might appear
    accessToken = await page.evaluate(() => {
      const modals = document.querySelectorAll('[role="dialog"], [class*="modal"], [class*="popup"], [class*="overlay"]');
      for (const modal of modals) {
        const txt = modal.innerText || "";
        // Look for token-like strings
        const match = txt.match(/([A-Za-z0-9_\-./+=]{32,})/);
        if (match) return match[1];
      }
      return null;
    }).catch(() => null);

    if (accessToken) {
      log("[TOKEN] ✅ Access Token found in dialog! (length: " + accessToken.length + ")");
      return accessToken;
    }

    if (i % 3 === 0) log("[TOKEN] Waiting for token... (" + (i * 2) + "s)");
    await new Promise(r => setTimeout(r, 2000));
  }

  // Last resort: take a screenshot and try to get from page snapshot
  log("[TOKEN] ⚠️ Token not found via standard methods, trying page snapshot...");
  const pageSnapshot = await getBodyText(page, 2000);
  const snapshotMatch = pageSnapshot.match(/([A-Za-z0-9_\-./+=]{32,})/);
  if (snapshotMatch) {
    log("[TOKEN] ✅ Found token in page text! (length: " + snapshotMatch[1].length + ")");
    return snapshotMatch[1];
  }

  log("[TOKEN] ⚠️ Could not retrieve Access Token automatically");
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

    // ★ DO NOT clear cookies — they carry the session needed for redirect
    try {
      await page.goto(link, { waitUntil: "domcontentloaded", timeout: 60000 });
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

    // Step 5b: Wait for Turnstile auto-solve + auto-redirect → handle page
    // ★ Turnstile extension (world:MAIN, all_frames:true) auto-bypasses CAPTCHA
    // ★ NO button clicks — page auto-redirects after Turnstile passes
    log("  Waiting for Turnstile auto-solve + redirect (NO clicks)...");
    let reachedHandlePage = false;
    const startUrl = page.url();

    for (let i = 0; i < 60; i++) {
      const txt = await getBodyText(page, 600);
      const currentUrl = page.url();

      // Check if we reached the handle page
      if (/choose your handle/i.test(txt) || (currentUrl.includes("/signup") && /handle/i.test(txt))) {
        log("  ✅ Reached handle page!");
        reachedHandlePage = true;
        break;
      }

      // Check for expired/invalid link
      if (/invalid|expired/i.test(txt) && !/redirecting|verif|turnstile|challenge/i.test(txt)) {
        throw new Error("Link expired after click");
      }

      // Monitor redirect progress
      if (/redirecting/i.test(txt)) {
        if (i % 5 === 0) log("  [" + (i * 3) + "s] Page redirecting...");
        await new Promise(r => setTimeout(r, 3000));
        continue;
      }

      // URL changed = redirect happened
      if (currentUrl !== startUrl && !currentUrl.includes("email-login/verify")) {
        log("  URL changed to: " + currentUrl);
        await new Promise(r => setTimeout(r, 3000));
        const afterTxt = await getBodyText(page, 400);
        if (/choose your handle/i.test(afterTxt)) {
          log("  ✅ Reached handle page after redirect!");
          reachedHandlePage = true;
          break;
        }
      }

      // Check Turnstile status (info only, no interaction)
      if (i % 10 === 0 && i > 0) {
        const tsStatus = await page.evaluate(() => {
          try {
            if (typeof turnstile !== 'undefined') {
              const res = turnstile.getResponse();
              if (res) return 'solved';
            }
          } catch(e) {}
          try {
            const input = document.querySelector('input[name="cf-turnstile-response"]');
            if (input && input.value) return 'solved';
          } catch(e) {}
          const iframes = document.querySelectorAll('iframe[src*="turnstile"], iframe[src*="challenges"]');
          if (iframes.length > 0) return 'pending_iframe';
          return 'no_turnstile';
        }).catch(() => 'unknown');
        log("  [" + (i * 3) + "s] Turnstile: " + tsStatus + " | URL: " + currentUrl.substring(0, 60));
      }

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

    const handle = email.split("@")[0].substring(0, 8).toLowerCase().replace(/[^a-z0-9]/g, "");
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

        // Step 8: Fetch Access Token
        let accessToken = null;
        if (config.fetchToken !== false) {
          try {
            accessToken = await fetchAccessToken(page, config, log);
            if (accessToken) {
              log("[TOKEN] Access Token saved successfully!");
              // Save token to dedicated "Access Tokens" folder
              const tokenDir = config.accessTokenDir || join(registeredDir || '.', "Access Tokens");
              if (!existsSync(tokenDir)) mkdirSync(tokenDir, { recursive: true });
              const tokenFile = join(tokenDir, email + ".txt");
              writeFileSync(tokenFile, [
                "email: " + email,
                "handle: " + handle,
                "zoAddress: " + handle + ".zo.computer",
                "accessToken: " + accessToken,
                "time: " + new Date().toISOString(),
              ].join("\n"), "utf-8");
              log("[TOKEN] Saved to: " + tokenFile);
            } else {
              log("[TOKEN] ⚠️ Token retrieval skipped or failed (non-fatal)");
            }
          } catch (tokenErr) {
            log("[TOKEN] ⚠️ Token error: " + tokenErr.message + " (non-fatal)");
          }
        }

        return { handle, zoAddress: handle + ".zo.computer", url: finalUrl, accessToken };
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

module.exports = { registerOne, launchBrowser, getMailToken, findMagicLink, pollMagicLink, fetchAccessToken, DEFAULT_CONFIG };
