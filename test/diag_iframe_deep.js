const puppeteer = require("puppeteer-core");
const { join } = require("path");
const fs = require("fs");

const extDir = join(__dirname, "..", "turnstile-extension");
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const bypassJs = fs.readFileSync(join(extDir, "script.js"), "utf8");

(async () => {
  const browser = await puppeteer.launch({
    executablePath: EDGE,
    headless: false,
    userDataDir: join(__dirname, "..", "temp_iframe_diag"),
    args: [
      "--no-first-run", "--no-default-browser-check", "--no-sandbox",
      "--load-extension=" + extDir,
      "--disable-blink-features=AutomationControlled",
    ],
    ignoreDefaultArgs: ["--enable-automation"],
    enableExtensions: true,
  });

  const page = (await browser.pages())[0] || await browser.newPage();
  await page.evaluateOnNewDocument(bypassJs);

  // Go to a page with Turnstile widget
  await page.goto("https://zo.computer/signup", { waitUntil: "networkidle2", timeout: 30000 });
  await new Promise(r => setTimeout(r, 5000));

  // Check main frame
  const mainCheck = await page.evaluate(() => ({
    bypass: !!window.__CF_BYPASS__,
    webdriver: navigator.webdriver,
    screenX: window.screenX,
    url: location.href,
  }));
  console.log("MAIN FRAME:", JSON.stringify(mainCheck));

  // Find ALL frames and check each one
  const frames = page.frames();
  console.log("Total frames:", frames.length);

  for (let i = 0; i < frames.length; i++) {
    const frame = frames[i];
    const url = frame.url();
    try {
      const check = await frame.evaluate(() => ({
        bypass: !!window.__CF_BYPASS__,
        webdriver: navigator.webdriver,
        screenX: window.screenX,
        screenY: window.screenY,
        hasTurnstile: typeof turnstile !== "undefined",
        hasCheckbox: !!document.querySelector('[type="checkbox"], .cb-i, .mark'),
        bodyText: (document.body ? document.body.innerText : "").substring(0, 100),
      }));
      console.log("FRAME[" + i + "] " + url.substring(0, 80) + ":", JSON.stringify(check));
    } catch (e) {
      console.log("FRAME[" + i + "] " + url.substring(0, 80) + ": ACCESS DENIED (" + e.message.substring(0, 50) + ")");
    }
  }

  // Also check iframes via DOM
  const iframeInfo = await page.evaluate(() => {
    const iframes = document.querySelectorAll("iframe");
    return Array.from(iframes).map(f => ({
      src: f.src || f.getAttribute("src") || "",
      w: f.offsetWidth, h: f.offsetHeight,
      x: f.getBoundingClientRect().x, y: f.getBoundingClientRect().y,
    }));
  });
  console.log("\nDOM iframes:", JSON.stringify(iframeInfo, null, 2));

  await page.screenshot({ path: "debug_iframe_diag.png", fullPage: true });
  await browser.close();
})();
