/**
 * ZO Computer - Core Registration Logic
 * Modular plugin for batch email registration
 */
const puppeteer = require("puppeteer-core");
const { writeFileSync, readFileSync, appendFileSync, existsSync, mkdirSync } = require("fs");
const { join, resolve, dirname } = require("path");
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
    "--renderer-process-limit=2", "--process-per-site",
    "--disable-features=msSmartScreenProtection,msEdgeShopping,msEdgeWalletCheckoutExperience,msEdgeSidebar,msEdgeCollections",
  ];

  // ★ Load Turnstile bypass extension (world:MAIN, all_frames:true)
  // ★ ALSO disable all other extensions to save memory
  if (extExists) {
    const extPath = resolve(extDir).replace(/\\/g, '/');
    launchArgs.push("--disable-extensions-except=" + extPath);
    launchArgs.push("--load-extension=" + extPath);
    log("[BROWSER] Turnstile extension loaded from: " + extDir);
  } else {
    launchArgs.push("--disable-extensions");
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
    enableExtensions: true,  // ★ puppeteer-core 25.x: 不加这个会默认 --disable-extensions
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
  const bufferMs = 120000; // 2 minute buffer to avoid race conditions
  const filterTime = new Date(afterTime.getTime() - bufferMs).toISOString();
  const url = (config.graphMailUrl || DEFAULT_CONFIG.graphMailUrl)
    + "?$top=10&$select=subject,body,from,receivedDateTime"
    + "&$filter=receivedDateTime ge " + encodeURIComponent(filterTime)
    + "&$orderby=receivedDateTime%20desc";
  const resp = await fetch(url, { headers: { Authorization: "Bearer " + accessToken } });
  const mail = await resp.json();
  if (!mail.value || mail.value.value?.length === 0 && mail.value.length === 0) return null;
  const messages = mail.value || [];
  const bufferedAfterTime = new Date(afterTime.getTime() - bufferMs);

  for (const msg of messages) {
    const recvTime = new Date(msg.receivedDateTime);
    if (recvTime < bufferedAfterTime) continue;

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
  const deadline = Date.now() + 60000;
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
      const errMsg = e.message || '';
      // ★ AADSTS/Token errors are permanent — no point retrying
      if (/AADSTS|invalid_grant|application.*not found|invalid.*refresh.token|account.*disabled/i.test(errMsg)) {
        log("[POLL] 🚫 Permanent token error: " + errMsg.substring(0, 100));
        throw e; // throw immediately so caller can skip this account
      }
      log("[POLL] Error: " + errMsg.substring(0, 100));
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
// Click a button matching the given regex — uses forceClick with proper mouse events
// ★ Puppeteer native click by visible text — uses CDP Input.dispatchMouseEvent (real mouse events)
// NO page.evaluate el.click() — that's synthetic JS click which React ignores
async function realClickByText(page, pattern) {
  // ★ Split on | FIRST, then clean each keyword individually
  const rawSource = pattern.source;
  const rawKeywords = rawSource.split(/\s*\|\s*/);
  const keywords = rawKeywords.map(k =>
    k.replace(/\\s\*/g, ' ').replace(/\\s\+/g, ' ').replace(/[.*+?^${}()\[\]\\]/g, '').trim()
  ).filter(k => k.length > 0);
  for (const kw of keywords) {
    const cleanKw = kw.replace(/\\s/g, ' ').trim();
    if (!cleanKw) continue;
    const xpathExpr = `//button[contains(translate(., 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), '${cleanKw.toLowerCase()}')]|//a[contains(translate(., 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), '${cleanKw.toLowerCase()}')]|//div[@role='button'][contains(translate(., 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), '${cleanKw.toLowerCase()}')]`;
    let elements;
    try { elements = await page.$x(xpathExpr); } catch(e) { continue; }
    for (const el of elements) {
      try {
        const box = await el.boundingBox();
        if (!box || box.width <= 0 || box.height <= 0) continue;
        const x = box.x + box.width / 2;
        const y = box.y + box.height / 2;
        await page.mouse.move(x, y);
        await new Promise(r => setTimeout(r, 80));
        await page.mouse.click(x, y);
        await el.dispose();
        return true;
      } catch(e) {
        try { await el.dispose(); } catch(e2) {}
      }
    }
  }
  // Last resort: find via evaluate, get coords, click with page.mouse
  try {
    const coords = await page.evaluate((kwList) => {
      for (const kw of kwList) {
        const re = new RegExp(kw, 'i');
        for (const sel of ['button', 'a', 'div[role=button]']) {
          for (const el of document.querySelectorAll(sel)) {
            if (!re.test((el.textContent || '').trim())) continue;
            const rect = el.getBoundingClientRect();
            if (rect.width <= 0 || rect.height <= 0) continue;
            return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
          }
        }
      }
      return null;
    }, keywords);
    if (coords) {
      await page.mouse.move(coords.x, coords.y);
      await new Promise(r => setTimeout(r, 80));
      await page.mouse.click(coords.x, coords.y);
      return true;
    }
  } catch(e) {}
  return false;
}

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
// ★ ALL interactions use CDP native control: page.mouse.click, page.keyboard.type/press
// ★ NO page.evaluate el.click() — React/synthetic clicks ignored
async function fetchAccessToken(page, handle, config, log) {
  log("[TOKEN] Starting Access Token retrieval...");

  let settingsLoaded = false;

  // Strategy A: Try URL patterns (settings is inside user's ZO space — space must be booted first!)
  const settingsUrls = [
    "https://" + handle + ".zo.computer/settings",
    "https://" + handle + ".zo.computer/settings/advanced",
    "https://www.zo.computer/settings",
    "https://www.zo.computer/account/settings",
    "https://www.zo.computer/dashboard/settings",
    "https://app.zo.computer/settings",
  ];
  for (const sUrl of settingsUrls) {
    try {
      log("[TOKEN] Trying URL: " + sUrl);
      await page.goto(sUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
      await new Promise(r => setTimeout(r, 8000));
      const txt = await getBodyText(page, 800);
      if (/setting|advanced|profile|account|general|token|api.?key|\u8BBE\u7F6E|\u9AD8\u7EA7|\u4E2A\u4EBA|\u8D26\u6237|\u5BC6\u94A5|\u4EE4\u724C/i.test(txt)) {
        log("[TOKEN] ✅ Settings page loaded via URL!");
        settingsLoaded = true;
        break;
      }
      log("[TOKEN] Page text: " + txt.substring(0, 120).replace(/\n/g, " | "));
    } catch (e) {
      log("[TOKEN] Nav error: " + e.message.substring(0, 50));
    }
  }

  // Strategy B: Go to dashboard, click user profile to open menu → Settings
  if (!settingsLoaded) {
    log("[TOKEN] Going to dashboard to find settings via UI...");
    try {
      await page.goto("https://" + handle + ".zo.computer/", { waitUntil: "domcontentloaded", timeout: 30000 });
      await new Promise(r => setTimeout(r, 15000));
    } catch(e) {
      log("[TOKEN] Dashboard nav error: " + e.message.substring(0, 50));
    }

    // Log all visible links/buttons for debugging
    const uiElements = await page.evaluate(() => {
      const items = [];
      for (const a of document.querySelectorAll('a[href], button, [role="button"]')) {
        const txt = (a.textContent || "").trim().substring(0, 60);
        const href = a.getAttribute("href") || "";
        const aria = a.getAttribute("aria-label") || "";
        const rect = a.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0 && (txt || aria)) {
          items.push({ txt, href: href.substring(0, 80), aria, tag: a.tagName });
        }
      }
      return items;
    }).catch(() => []);
    log("[TOKEN] Dashboard UI elements (" + uiElements.length + "):");
    for (const el of uiElements.slice(0, 30)) {
      log("  " + el.tag + " [" + (el.txt || el.aria) + "] href=" + el.href);
    }

    // ★ CDP click on user profile (handle text in nav bar)
    log("[TOKEN] CDP click on user profile element...");
    const profileClicked = await realClickByText(page, new RegExp(handle, 'i'));
    if (!profileClicked) {
      log("[TOKEN] Handle text not found as button, trying avatar/profile icon...");
      // Try clicking avatar or profile-related element by position
      const avatarCoords = await page.evaluate(() => {
        // Look for elements that might be user avatar/profile in top-right area
        for (const sel of ['img', '[class*="avatar"]', '[class*="profile"]', '[class*="user"]', '[aria-label*="profile" i]', '[aria-label*="account" i]']) {
          for (const el of document.querySelectorAll(sel)) {
            const rect = el.getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0 && rect.top < 100) { // top bar area
              return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
            }
          }
        }
        return null;
      }).catch(() => null);
      if (avatarCoords) {
        log("[TOKEN] CDP click avatar at (" + Math.round(avatarCoords.x) + "," + Math.round(avatarCoords.y) + ")");
        await page.mouse.click(avatarCoords.x, avatarCoords.y);
      }
    }
    await new Promise(r => setTimeout(r, 5000));

    // Check for dropdown menu
    const menuTxt = await getBodyText(page, 1500);
    log("[TOKEN] After profile click: " + menuTxt.substring(0, 200).replace(/\n/g, " | "));

    if (/settings|setting|\u8BBE\u7F6E/i.test(menuTxt)) {
      log("[TOKEN] 'Settings' in menu — CDP click...");
      const clicked = await realClickByText(page, /settings|\u8BBE\u7F6E/i);
      if (clicked) {
        // ★ Poll up to 30s for settings content to load
        log("[TOKEN] Waiting for settings page to load...");
        for (let w = 0; w < 15; w++) {
          await new Promise(r => setTimeout(r, 2000));
          const afterTxt = await getBodyText(page, 800);
          if (/setting|advanced|profile|account|general|token|api.?key|设置|高级|个人|账户|密钥|令牌/i.test(afterTxt)) {
            settingsLoaded = true;
            log("[TOKEN] ✅ Settings opened via menu! (waited " + ((w+1)*2) + "s)");
            break;
          }
          log("[TOKEN] Settings not ready yet (" + ((w+1)*2) + "s): " + afterTxt.substring(0, 80).replace(/\n/g, " | "));
        }
      }
    }

    // Strategy C: Find settings link href
    if (!settingsLoaded) {
      log("[TOKEN] Scanning for settings href...");
      const settingsHref = await page.evaluate(() => {
        for (const a of document.querySelectorAll('a[href]')) {
          const href = a.getAttribute("href") || "";
          const txt = (a.textContent || "").trim();
          if (/setting/i.test(href) || /setting/i.test(txt)) return a.href;
        }
        return null;
      }).catch(() => null);
      if (settingsHref) {
        log("[TOKEN] Found href: " + settingsHref);
        try {
          await page.goto(settingsHref, { waitUntil: "domcontentloaded", timeout: 30000 });
          // Poll for settings to load
          for (let w = 0; w < 10; w++) {
            await new Promise(r => setTimeout(r, 2000));
            const txt = await getBodyText(page, 800);
            if (/setting|advanced|profile|account|token|api.?key|设置|高级|个人|账户|密钥|令牌/i.test(txt)) {
              settingsLoaded = true;
              log("[TOKEN] ✅ Settings loaded via href! (waited " + ((w+1)*2) + "s)");
              break;
            }
          }
        } catch(e) {}
      }
    }

    // Strategy D: Click gear/settings icon by coords
    if (!settingsLoaded) {
      log("[TOKEN] Trying gear/settings icon CDP click...");
      const iconCoords = await page.evaluate(() => {
        for (const sel of ['[aria-label*="setting" i]', '[aria-label*="Setting"]', '[class*="gear"]', '[class*="setting"]', '[class*="cog"]']) {
          for (const el of document.querySelectorAll(sel)) {
            const rect = el.getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0) {
              return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
            }
          }
        }
        return null;
      }).catch(() => null);
      if (iconCoords) {
        log("[TOKEN] CDP click gear icon at (" + Math.round(iconCoords.x) + "," + Math.round(iconCoords.y) + ")");
        await page.mouse.click(iconCoords.x, iconCoords.y);
        // Poll for settings to load
        for (let w = 0; w < 10; w++) {
          await new Promise(r => setTimeout(r, 2000));
          const txt = await getBodyText(page, 800);
          if (/setting|advanced|profile|account|token|api.?key|设置|高级|个人|账户|密钥|令牌/i.test(txt)) {
            settingsLoaded = true;
            log("[TOKEN] ✅ Settings via gear icon! (waited " + ((w+1)*2) + "s)");
            break;
          }
        }
      }
    }
  }

  if (!settingsLoaded) {
    try {
      const ssPath = join(dirname(__dirname), "registered", "debug_token_" + handle + ".png");
      await page.screenshot({ path: ssPath, fullPage: false });
      log("[TOKEN] Debug screenshot: " + ssPath);
    } catch(e) {}
    log("[TOKEN] ⚠️ Could not find settings page, skipping token retrieval");
    return null;
  }

  // Step T2: Click "Advanced" tab — ★ CDP native click via realClickByText
  log("[TOKEN] CDP clicking Advanced tab...");
  let advancedClicked = false;
  for (let attempt = 0; attempt < 5 && !advancedClicked; attempt++) {
    advancedClicked = await realClickByText(page, /advanced|高级/i);
    if (advancedClicked) {
      log("[TOKEN] Advanced tab clicked!");
      await new Promise(r => setTimeout(r, 10000));
      break;
    }
    await new Promise(r => setTimeout(r, 2000));
  }
  if (!advancedClicked) {
    log("[TOKEN] ⚠️ Advanced tab not found, looking for token section directly...");
  }
  // Step T3-T4: Find and fill key name input — ★ CDP mouse.click + keyboard.type
  const keyName = config.tokenKeyName || "MyApiKey";
  log("[TOKEN] Entering key name: " + keyName);

  let keyNameFilled = false;
  for (let attempt = 0; attempt < 15 && !keyNameFilled; attempt++) {
    const inputCoords = await page.evaluate(() => {
      const allInputs = document.querySelectorAll('input[type="text"], input:not([type]), input[placeholder]');
      for (const inp of allInputs) {
        const ph = (inp.placeholder || "").toLowerCase();
        const ariaLabel = (inp.getAttribute("aria-label") || "").toLowerCase();
        const parent = inp.closest('div, label, section, fieldset');
        const parentText = parent ? (parent.textContent || "").toLowerCase() : "";
        // ★ Only match Access Tokens input (ph="Key name (e.g..."), NOT Keys input (ph="KEY_NAME (or paste...)")
        if (/key name \(e\.g/i.test(inp.placeholder || '') ||
            /access.?token/i.test(parentText) && /key.?name/i.test(ph)) {
          const rect = inp.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) {
            return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
          }
        }
      }
      return null;
    }).catch(() => null);

    if (inputCoords) {
      // ★ CDP: click input → select all → type
      await page.mouse.click(inputCoords.x, inputCoords.y);
      await new Promise(r => setTimeout(r, 300));
      await page.keyboard.down('Control');
      await page.keyboard.press('a');
      await page.keyboard.up('Control');
      await page.keyboard.press('Backspace');
      await page.keyboard.type(keyName, { delay: 30 });
      keyNameFilled = true;
      log("[TOKEN] Key name filled via CDP click+type!");
    }

    if (!keyNameFilled) {
      // Fallback: find any visible text input near token-related text
      const inputs = await page.$$('input[type="text"], input:not([type="hidden"]):not([type="submit"]):not([type="checkbox"]):not([type="radio"])');
      for (const inp of inputs) {
        const visible = await inp.evaluate(e => e.offsetParent !== null).catch(() => false);
        if (!visible) continue;
        const ph = await inp.evaluate(e => (e.placeholder || "")).catch(() => "");
        const parentText = await inp.evaluate(e => {
          const p = e.closest('div, label, section');
          return p ? p.textContent.substring(0, 100).toLowerCase() : "";
        }).catch(() => "");
        if (/key name \(e\.g/i.test(ph) || (/access.?token/i.test(parentText) && /key.?name/i.test(ph))) {
          // ★ CDP: click the input element directly
          const box = await inp.boundingBox();
          if (box) {
            await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
            await new Promise(r => setTimeout(r, 300));
            await page.keyboard.down('Control');
            await page.keyboard.press('a');
            await page.keyboard.up('Control');
            await page.keyboard.press('Backspace');
            await page.keyboard.type(keyName, { delay: 30 });
            keyNameFilled = true;
            log("[TOKEN] Key name filled via CDP boundingBox+type!");
            break;
          }
        }
      }
    }
    if (!keyNameFilled) await new Promise(r => setTimeout(r, 3000));
  }

  if (!keyNameFilled) {
    log("[TOKEN] ⚠️ Failed to fill key name input");
    try {
      const ssPath = join(dirname(__dirname), "registered", "debug_token_input_" + handle + ".png");
      await page.screenshot({ path: ssPath, fullPage: false });
      log("[TOKEN] Debug screenshot: " + ssPath);
    } catch(e) {}
    return null;
  }
  await new Promise(r => setTimeout(r, 1000));
  // Step T5: Click "Add" button in the Access Tokens section (NOT the Keys section)
  // ★ There are TWO Add buttons: first for Keys (env vars), second for Access Tokens
  log("[TOKEN] CDP clicking Access Tokens Add button (2nd Add)...");
  let addClicked = false;
  for (let attempt = 0; attempt < 5 && !addClicked; attempt++) {
    const addCoords = await page.evaluate(() => {
      const addBtns = [];
      for (const btn of document.querySelectorAll('button')) {
        const txt = (btn.textContent || '').trim();
        if (/^Add$/i.test(txt)) {
          const rect = btn.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) {
            addBtns.push({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, idx: addBtns.length });
          }
        }
      }
      // Find "Access Tokens" heading position
      let atY = -1;
      for (const el of document.querySelectorAll('h1, h2, h3, h4, h5, h6, div, span, p')) {
        if (/^Access Tokens$/i.test((el.textContent || '').trim())) {
          const rect = el.getBoundingClientRect();
          if (rect.width > 0) { atY = rect.top; break; }
        }
      }
      // Pick Add button below Access Tokens heading
      if (atY >= 0) {
        const below = addBtns.filter(b => b.y > atY);
        if (below.length > 0) return below[0];
      }
      // Fallback: last Add button
      if (addBtns.length >= 2) return addBtns[addBtns.length - 1];
      if (addBtns.length === 1) return addBtns[0];
      return null;
    }).catch(() => null);
    if (addCoords) {
      log("[TOKEN] CDP click Add at (" + Math.round(addCoords.x) + "," + Math.round(addCoords.y) + ") idx=" + addCoords.idx);
      await page.mouse.click(addCoords.x, addCoords.y);
      addClicked = true;
      log("[TOKEN] Add button clicked!");
      break;
    }
    await new Promise(r => setTimeout(r, 2000));
  }

  if (!addClicked) {
    log("[TOKEN] ⚠️ Could not find Add button");
    return null;
  }

  // Step T6: Wait for token to appear and extract it
  log("[TOKEN] Waiting for token to be generated...");
  await new Promise(r => setTimeout(r, 5000));

  let accessToken = null;
  for (let i = 0; i < 20; i++) {
    accessToken = await page.evaluate(() => {
      for (const el of document.querySelectorAll('code, pre, [class*="token"], [class*="key"], [class*="secret"], [class*="copy"]')) {
        const txt = (el.textContent || "").trim();
        if (txt.length >= 20 && /^[A-Za-z0-9_\-./+=]+$/.test(txt)) return txt;
      }
      for (const el of document.querySelectorAll('input[readonly], textarea[readonly], input[type="text"]')) {
        const val = (el.value || "").trim();
        if (val.length >= 20 && /^[A-Za-z0-9_\-./+=]+$/.test(val)) return val;
      }
      const bodyText = document.body.innerText;
      const pats = [
        /(?:token|key|secret)[:\s]+([A-Za-z0-9_\-./+=]{20,})/i,
        /\b(zo_[A-Za-z0-9_\-]{20,})\b/,
        /\b(sk_[A-Za-z0-9_\-]{20,})\b/,
      ];
      for (const pat of pats) { const m = bodyText.match(pat); if (m) return m[1]; }
      for (const btn of document.querySelectorAll('[class*="copy"], button')) {
        if (/copy|复制/i.test((btn.textContent || "").trim())) {
          const sib = btn.previousElementSibling || btn.parentElement?.querySelector('code, pre, input, span');
          if (sib) { const val = (sib.textContent || sib.value || "").trim(); if (val.length >= 20) return val; }
        }
      }
      return null;
    }).catch(() => null);

    if (accessToken) {
      log("[TOKEN] ✅ Access Token retrieved! (length: " + accessToken.length + ")");
      return accessToken;
    }
    await new Promise(r => setTimeout(r, 2000));
  }

  log("[TOKEN] ⚠️ Token not found after waiting");
  try {
    const ssPath = join(dirname(__dirname), "registered", "debug_token_result_" + handle + ".png");
    await page.screenshot({ path: ssPath, fullPage: false });
    log("[TOKEN] Debug screenshot: " + ssPath);
  } catch(e) {}
  return null;
}


// ========== Register One Email ==========
async function registerOne(emailItem, config, log) {
  const { email, password, clientId, refreshToken } = emailItem;
  const registeredDir = config.registeredDir;
  let browser, tempDir;
  let capturedCookieAT = null;

  try {
    // Launch browser
    const launched = await launchBrowser(config, log);
    browser = launched.browser;
    tempDir = launched.tempDir;
    let page = launched.page;
    page.setDefaultTimeout(60000);
    await page.setViewport({ width: 1440, height: 900 });

    // ★ Listen for popup/new tab (e.g. "Go to your Zo" might open new window)
    let popupPage = null;
    browser.on('targetcreated', async (target) => {
      if (target.type() === 'page') {
        try {
          popupPage = await target.page();
          log("  [POPUP] New page detected: " + (popupPage?.url() || 'about:blank').substring(0, 70));
        } catch(e) {}
      }
    });

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
    let alreadyRegistered = false;
    const startUrl = page.url();

    for (let i = 0; i < 60; i++) {
      const txt = await getBodyText(page, 600);
      const currentUrl = page.url();

      // ★ Check if we landed directly on the main UI (already registered account)
      try {
        const hn = new URL(currentUrl).hostname;
        if (hn.endsWith('.zo.computer') && hn !== 'www.zo.computer' && !currentUrl.includes('/signup') && !currentUrl.includes('/email-login')) {
          // ★ Verify page actually shows main UI, not a registration form
          const needsReg = await page.evaluate(() => {
            const txt = document.body.innerText || '';
            const hasHandleInput = !!document.querySelector('input[placeholder*="you"], input[name="handle"], input[type="text"]:not([readonly])');
            const hasRegText = /choose.*handle|create.*handle|set.*username|complete.*profile|pick.*handle/i.test(txt);
            return hasHandleInput || hasRegText;
          }).catch(() => false);
          
          if (needsReg) {
            log("  ⚠️ Subdomain URL but needs registration (handle input detected): " + currentUrl);
            // Don't break — fall through to handle page detection
          } else {
            log("  ✅ Already registered! Directly at main UI: " + currentUrl);
            alreadyRegistered = true;
            reachedHandlePage = true;
            break;
          }
        }
      } catch(e) {}

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

        // ★ Stuck redirect recovery: after 60s, try manual confirm + navigate
        // (Turnstile typically takes 20-30s to solve; don't interrupt it too early)
        if (i >= 20 && currentUrl.includes('email-login/verify')) {
          log("  ★ Redirect stuck after 60s, attempting manual confirm...");
          try {
            // Extract token from URL
            const tokenMatch = currentUrl.match(/token=([^&]+)/);
            if (tokenMatch) {
              // Call confirm API from page context (POST — GET returns 405 now)
              const confirmResult = await page.evaluate(async (token) => {
                try {
                  const resp = await fetch('/api/email-login/confirm?token=' + token, {
                    method: 'POST',
                    headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
                    body: JSON.stringify({ token }),
                    credentials: 'include',
                    redirect: 'follow',
                  });
                  return { status: resp.status, ok: resp.ok };
                } catch(e) {
                  return { error: e.message };
                }
              }, tokenMatch[1]);
              log("  Confirm API: " + JSON.stringify(confirmResult));

              // Check if access_token cookie was set
              const cookiesAfterConfirm = await page.cookies();
              const atCookie = cookiesAfterConfirm.find(c => c.name === 'access_token' && c.domain.includes('zo.computer'));
              if (atCookie) {
                log("  ✅ access_token cookie set after manual confirm!");
              }

              // Navigate to redirect target
              const redirectMatch = currentUrl.match(/redirect=([^&]+)/);
              const redirectTarget = redirectMatch ? decodeURIComponent(redirectMatch[1]) : '/signup';
              log("  Navigating to: " + redirectTarget);
              try {
                await page.goto('https://www.zo.computer' + redirectTarget, { waitUntil: 'domcontentloaded', timeout: 30000 });
              } catch(navErr) {
                log("  Nav: " + navErr.message.substring(0, 50));
              }
              await new Promise(r => setTimeout(r, 3000));
              const afterNavUrl = page.url();
              log("  After nav: " + afterNavUrl);

              // Check for subdomain (already registered)
              try {
                const hn3 = new URL(afterNavUrl).hostname;
                if (hn3.endsWith('.zo.computer') && hn3 !== 'www.zo.computer') {
                  log("  ✅ Already registered! At subdomain: " + afterNavUrl);
                  alreadyRegistered = true;
                  reachedHandlePage = true;
                  break;
                }
              } catch(e) {}

              // Check for handle page
              const afterNavTxt = await getBodyText(page, 400);
              if (/choose your handle/i.test(afterNavTxt)) {
                log("  ✅ Reached handle page after manual redirect!");
                reachedHandlePage = true;
                break;
              }
            }
          } catch(recoverErr) {
            log("  Recovery failed: " + recoverErr.message);
          }
        }

        await new Promise(r => setTimeout(r, 3000));
        continue;
      }

      // URL changed = redirect happened
      if (currentUrl !== startUrl && !currentUrl.includes("email-login/verify")) {
        log("  URL changed to: " + currentUrl);
        await new Promise(r => setTimeout(r, 3000));

        // ★ Check for subdomain (already registered)
        try {
          const hn2 = new URL(page.url()).hostname;
          if (hn2.endsWith('.zo.computer') && hn2 !== 'www.zo.computer') {
            log("  ✅ Already registered! At subdomain: " + page.url());
            alreadyRegistered = true;
            reachedHandlePage = true;
            break;
          }
        } catch(e) {}

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
      else {
        // ★ Last check: maybe we're at a subdomain
        try {
          const fhn = new URL(page.url()).hostname;
          if (fhn.endsWith('.zo.computer') && fhn !== 'www.zo.computer') {
            log("  ✅ Already registered (final check)! At: " + page.url());
            alreadyRegistered = true;
            reachedHandlePage = true;
          }
        } catch(e) {}
        if (!reachedHandlePage) throw new Error("Failed to reach handle page: " + finalTxt.substring(0, 80));
      }
    }

    // ★ Skip handle + onboarding for already-registered accounts
    let handle;
    if (alreadyRegistered) {
      handle = new URL(page.url()).hostname.split('.')[0];
      finalUrl = page.url();
      log("  ★ Already registered, handle=" + handle + ", skipping Steps 6-7");
      
      // ★ Capture cookie AT while we're on the workspace page
      try {
        const cookies = await page.cookies();
        capturedCookieAT = cookies.find(c => c.name === 'access_token' && c.domain.includes('zo.computer'));
        if (capturedCookieAT) {
          log("  [COOKIE] ✅ AT captured directly: " + capturedCookieAT.value.substring(0, 30) + "...");
        } else {
          log("  [COOKIE] No AT yet, waiting 5s for cookie to set...");
          await new Promise(r => setTimeout(r, 5000));
          const cookies2 = await page.cookies();
          capturedCookieAT = cookies2.find(c => c.name === 'access_token' && c.domain.includes('zo.computer'));
          if (capturedCookieAT) log("  [COOKIE] ✅ AT captured after wait!");
        }
      } catch(e) {
        log("  [COOKIE] Capture error: " + e.message.substring(0, 50));
      }
    } else {

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

    // ★ Use Puppeteer native click — match "Continue" broadly (button may say "Continue to onboarding")
    const continueClicked = await realClickByText(page, /continue/i);
    log("  Continue click: " + (continueClicked ? "OK" : "FAILED"));
    // Wait for page transition
    await new Promise(r => setTimeout(r, 8000));
    // If still on handle page, try clicking again (button may have been disabled during validation)
    const afterClickTxt = await getBodyText(page, 500);
    if (/choose your handle|continue to onboarding/i.test(afterClickTxt)) {
      log("  Still on handle page, retrying Continue click...");
      await new Promise(r => setTimeout(r, 2000));
      await realClickByText(page, /continue/i);
      await new Promise(r => setTimeout(r, 8000));
    }

    // Step 7: Onboarding (Terms → Go to your Zo → Phone skip → Survey → Boot → Main UI)
    // ★ 智能轮询: 自适应间隔, 多维度检测, 快完成快退出, 慢就耐心等 (最长600s)
    log("[7/7] Onboarding flow (smart adaptive poll, up to 600s)...");
    let reachedMainUI = false;
    let finalUrl = "";
    let bootStartPct = -1;       // 上次记录的boot百分比
    let bootLastChangeTime = 0;  // boot百分比上次变化的时间
    let consecutiveStale = 0;    // 连续无变化次数
    const BOOT_STALL_THRESHOLD = 90000; // boot无进展超过90秒视为卡死

    const onboardingStart = Date.now();
    const MAX_ONBOARDING = 600000; // 600秒

    while (Date.now() - onboardingStart < MAX_ONBOARDING) {
      // ★ 自适应间隔: 前30秒每1秒检查, 30-120秒每2秒, 之后每3秒
      const elapsed = Date.now() - onboardingStart;
      const interval = elapsed < 30000 ? 1000 : (elapsed < 120000 ? 2000 : 3000);
      await new Promise(r => setTimeout(r, interval));

      const txt = await getBodyText(page, 1000);
      const url = page.url();
      const hostname = (() => { try { return new URL(url).hostname; } catch(e) { return ''; } })();
      const isSubdomain = hostname.endsWith('.zo.computer') && hostname !== 'www.zo.computer';
      const secs = Math.round(elapsed / 1000);

      if (secs % 15 === 0 && secs > 0) {
        log("  [" + secs + "s] URL: " + url.substring(0, 70) + " | Host: " + hostname);
        log("         Text: " + txt.substring(0, 150).replace(/\n/g, " | "));
      }

      // ★ Completion: smart multi-signal detection
      if (isSubdomain) {
        let score = 0;
        const signals = [];
        // Signal 1: No loading indicators
        if (!/booting|starting|loading|preparing|creating/i.test(txt) && !txt.match(/\d+%/)) { score++; signals.push("noLoading"); }
        // Signal 2: Sidebar items
        if (/\bhome\b/i.test(txt) && (/\bfiles\b|automations|browser|skills|hosting|integrations|settings/i.test(txt))) { score++; signals.push("sidebar"); }
        // Signal 3: Chat/workspace content
        if (/dashboard|welcome|explore|zo space|your conversations|chat|new chat|GPT|claude|model|what can|how can|ask me/i.test(txt)) { score++; signals.push("chatContent"); }
        // Signal 4: Chat input or send button (DOM check)
        const hasInput = await page.evaluate(() => {
          for (const el of document.querySelectorAll('textarea, [contenteditable=true]')) {
            if (el.offsetWidth > 100 && el.offsetHeight > 0) return true;
          }
          for (const btn of document.querySelectorAll('button')) {
            if (/send/i.test((btn.textContent||'').trim()) && btn.offsetWidth > 0) return true;
          }
          for (const el of document.querySelectorAll('[role="textbox"]')) {
            if (el.offsetWidth > 100 && el.offsetHeight > 0) return true;
          }
          return false;
        }).catch(() => false);
        if (hasInput) { score++; signals.push("chatInput"); }

        // ★ 更智能的判定:
        // - chatInput 单独就够 (有输入框 = 聊天界面就绪)
        // - 或任意 2 个信号
        const chatInputReady = signals.includes("chatInput");
        if (chatInputReady || score >= 2) {
          log("  ✅ Reached ZO main interface (" + secs + "s, signals: " + signals.join("+") + ")");
          reachedMainUI = true;
          finalUrl = url;
          break;
        }
      }

      // Handle onboarding pages in priority order:

      // ⓪ "Continue to onboarding" link
      if (/continue to onboarding/i.test(txt)) {
        log("  [Onboarding] 'Continue to onboarding' detected, clicking...");
        await realClickByText(page, /continue to onboarding/i);
        await new Promise(r => setTimeout(r, 3000));
        consecutiveStale = 0;
        continue;
      }

      // ① Terms of Use / 18 years checkbox
      const hasCheckboxUI = await page.evaluate(() => {
        return document.querySelectorAll('input[type=checkbox], [role=checkbox], [role=switch], .checkbox, .toggle-switch').length > 0;
      }).catch(() => false);
      if (hasCheckboxUI && /terms|agree|privacy|18.*years/i.test(txt)) {
        log("  [Onboarding] Terms/checkbox page detected");
        const cbCoords = await page.evaluate(() => {
          const results = [];
          for (const cb of document.querySelectorAll('input[type=checkbox]')) {
            if (!cb.checked) {
              const rect = cb.getBoundingClientRect();
              if (rect.width > 0 && rect.height > 0) results.push({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
              const label = cb.closest('label');
              if (label) { const lr = label.getBoundingClientRect(); if (lr.width > 0 && lr.height > 0) results.push({ x: lr.left + lr.width / 2, y: lr.top + lr.height / 2 }); }
            }
          }
          return results;
        });
        for (const c of cbCoords) { await page.mouse.click(c.x, c.y); await new Promise(r => setTimeout(r, 300)); }
        await new Promise(r => setTimeout(r, 1000));
        await realClickByText(page, /skip\s*for\s*now|skip|continue/i);
        consecutiveStale = 0;
        continue;
      }

      // ② Go to your Zo / Get Started / Continue to your Zo
      if (/go to your zo|get started|continue to your/i.test(txt)) {
        const urlBefore = page.url();
        log("  [Onboarding] 'Go to your Zo' detected — clicking...");
        const clicked = await realClickByText(page, /go to your zo|get\s*started|continue to your/i);
        log("  [Onboarding] Click result: " + (clicked ? "OK" : "FAILED"));
        // ★ 自适应等待: 先等3秒，然后每秒检查是否已经开始跳转/boot
        await new Promise(r => setTimeout(r, 3000));
        for (let navWait = 0; navWait < 12; navWait++) {
          const navUrl = page.url();
          const navTxt = await getBodyText(page, 500);
          if (navUrl !== urlBefore || /booting|starting|loading|preparing|%/i.test(navTxt)) {
            log("  [Onboarding] Navigation detected: " + navUrl.substring(0, 60));
            break;
          }
          // Check for popup/new tab
          if (popupPage && popupPage.url().startsWith('http') && !popupPage.url().includes('/signup')) {
            page = popupPage; popupPage = null;
            log("  ★ Switched to popup: " + page.url().substring(0, 70));
            await page.bringToFront();
            break;
          }
          const allPages = await browser.pages();
          for (const p of allPages) {
            const pUrl = p.url();
            if (!pUrl.includes("/signup") && !pUrl.includes("about:") && pUrl.startsWith("http") && p !== page) {
              page = p;
              log("  ★ Switched to new page: " + pUrl.substring(0, 70));
              await p.bringToFront();
              break;
            }
          }
          await new Promise(r => setTimeout(r, 1000));
        }
        consecutiveStale = 0;
        continue;
      }

      // ③ Phone verification → Skip
      if (/verify your phone|phone number|add your phone|mobile number/i.test(txt)) {
        log("  [Onboarding] Phone verification detected, skipping...");
        if (!await realClickByText(page, /skip|not now|maybe later/i)) {
          await realClickByText(page, /^Continue$/i);
        }
        consecutiveStale = 0;
        continue;
      }

      // ④ Survey / preference selection
      if (/what.*(interest|prefer|use)|select.*(interest|preference)|choose.*(interest)|tell us/i.test(txt)) {
        log("  [Onboarding] Survey detected, picking random option...");
        const optCoords = await page.evaluate(() => {
          const opts = [];
          for (const sel of ['button', 'div[role=button]', 'label', '[class*=option]']) {
            for (const el of document.querySelectorAll(sel)) {
              const rect = el.getBoundingClientRect();
              if (rect.width > 0 && rect.height > 0 && el.textContent.trim().length > 0) opts.push({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
            }
          }
          return opts;
        });
        if (optCoords.length > 0) { const pick = optCoords[Math.floor(Math.random() * optCoords.length)]; await page.mouse.click(pick.x, pick.y); }
        await new Promise(r => setTimeout(r, 1500));
        await realClickByText(page, /continue|next|skip|done/i);
        consecutiveStale = 0;
        continue;
      }

      // ⑤ Boot loading (percentage / booting) — 追踪进度，检测卡死
      const pct = txt.match(/(\d+\.?\d*)%/);
      if (/booting|starting|loading|preparing|creating/i.test(txt) || pct) {
        if (pct) {
          const pctNum = parseFloat(pct[1]);
          if (pctNum !== bootStartPct) {
            // 百分比有变化，重置计时器
            bootStartPct = pctNum;
            bootLastChangeTime = Date.now();
            consecutiveStale = 0;
            log("  Boot: " + pctNum + "% (" + secs + "s)");
          } else if (bootLastChangeTime > 0 && Date.now() - bootLastChangeTime > BOOT_STALL_THRESHOLD) {
            // 百分比超过90秒没变化 → 可能卡死
            log("  ⚠️ Boot stalled at " + pctNum + "% for " + Math.round((Date.now() - bootLastChangeTime) / 1000) + "s");
            // 给最后一次机会：检查页面是否已经有聊天界面
            const stallUrl = page.url();
            const stallHost = (() => { try { return new URL(stallUrl).hostname; } catch(e) { return ''; } })();
            if (stallHost.endsWith('.zo.computer') && stallHost !== 'www.zo.computer') {
              const stallHasInput = await page.evaluate(() => {
                for (const el of document.querySelectorAll('textarea, [contenteditable=true], [role="textbox"]')) {
                  if (el.offsetWidth > 100 && el.offsetHeight > 0) return true;
                }
                return false;
              }).catch(() => false);
              if (stallHasInput) {
                log("  ✅ Chat interface found despite stalled boot indicator!");
                reachedMainUI = true;
                finalUrl = stallUrl;
                break;
              }
            }
            // 确认卡死，尝试刷新
            log("  🔄 Attempting page reload to recover...");
            try { await page.reload({ waitUntil: "domcontentloaded", timeout: 30000 }); } catch(e) {}
            bootLastChangeTime = Date.now(); // 重置计时器
            bootStartPct = -1;
            await new Promise(r => setTimeout(r, 5000));
            continue;
          }
          if (secs % 10 === 0) log("  Boot: " + pctNum + "% (" + secs + "s)");
        } else {
          // 有 booting/starting 文字但没有百分比
          if (bootLastChangeTime === 0) bootLastChangeTime = Date.now();
          if (secs % 10 === 0) log("  Boot: waiting... (" + secs + "s)");
        }
        consecutiveStale = 0;
        continue;
      }

      // ⑥ Profile fallback
      if (/set up your profile|display name/i.test(txt)) {
        log("  [Onboarding] Profile fallback, clicking Continue...");
        await realClickByText(page, /continue|skip/i);
        consecutiveStale = 0;
        continue;
      }

      // ❼ Generic Continue/Skip fallback — 最多点3次，避免误操作
      if (/continue|skip|next/i.test(txt) && !/booting|starting|loading|%/i.test(txt)) {
        consecutiveStale++;
        if (consecutiveStale <= 3) {
          log("  [Onboarding] Generic fallback (#" + consecutiveStale + "): clicking Continue/Skip...");
          if (!await realClickByText(page, /continue/i)) {
            if (!await realClickByText(page, /skip/i)) {
              await realClickByText(page, /next/i);
            }
          }
          await new Promise(r => setTimeout(r, 3000));
        }
        continue;
      }

      // Fatal errors
      if (/invalid|expired|something went wrong/i.test(txt) && !/booting|starting|%/i.test(txt)) {
        throw new Error("Onboarding error: " + txt.substring(0, 60));
      }
    }

    if (!reachedMainUI) {
      const finalTxt = await getBodyText(page, 800);
      finalUrl = page.url();
      log("  ⚠️ Onboarding timeout. URL: " + finalUrl + " | Text: " + finalTxt.substring(0, 200));
      const hn = (() => { try { return new URL(finalUrl).hostname; } catch(e) { return ''; } })();
      if (hn.endsWith('.zo.computer') && hn !== 'www.zo.computer') {
        log("  ★ At subdomain, attempting token retrieval anyway...");
        reachedMainUI = true;
      } else {
        throw new Error("Onboarding timeout (" + Math.round(MAX_ONBOARDING/1000) + "s)");
      }
    }

    } // end of else (not alreadyRegistered)

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
        accessToken = await fetchAccessToken(page, handle, config, log);
        if (accessToken) {
          log("[TOKEN] Access Token saved successfully!");
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

    return { handle, zoAddress: handle + ".zo.computer", url: finalUrl, accessToken, cookieAT: capturedCookieAT };

  } finally {
    if (browser) {
      // ★ Cookie AT capture (for batch_cookie_at.js)
      if (global.__zoCookieCallback) {
        try {
          // Use pre-captured cookie if available
          let atCookie = capturedCookieAT || null;
          
          // If not pre-captured, try getting from browser
          if (!atCookie) {
            const allCookies = await browser.cookies();
            atCookie = allCookies.find(c => c.name === 'access_token' && c.domain.includes('zo.computer'));
            if (atCookie) log("[COOKIE] ✅ AT found in browser cookies");
          }
          
          // Last resort: navigate to workspace and try
          if (!atCookie && typeof handle !== 'undefined' && handle) {
            const wsUrl = `https://${handle}.zo.computer/`;
            log("[COOKIE] Trying workspace nav: " + wsUrl);
            try {
              const pages = await browser.pages();
              const cookiePage = pages[pages.length - 1] || pages[0];
              await cookiePage.goto(wsUrl, { waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {});
              await new Promise(r => setTimeout(r, 8000));
              const allCookies = await browser.cookies();
              atCookie = allCookies.find(c => c.name === 'access_token' && c.domain.includes('zo.computer'));
              if (atCookie) log("[COOKIE] ✅ AT captured on retry!");
              else log("[COOKIE] ❌ Still no AT after retry");
            } catch(e) {
              log("[COOKIE] Retry nav failed: " + e.message.substring(0, 60));
            }
          }
          
          if (atCookie) {
            global.__zoCookieCallback(atCookie);
          }
        } catch(e) {
          log("[COOKIE] Capture error: " + e.message);
        }
      }
      try { await browser.close(); } catch (e) {}
      if (tempDir) try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch (e) {}
      log("[BROWSER] Cleaned up");
    }
  }
}

module.exports = { registerOne, launchBrowser, getMailToken, findMagicLink, pollMagicLink, fetchAccessToken, DEFAULT_CONFIG };
