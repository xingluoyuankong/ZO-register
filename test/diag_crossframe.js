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
    userDataDir: join(__dirname, "..", "temp_cdp_target"),
    args: [
      "--no-first-run", "--no-default-browser-check", "--no-sandbox",
      "--disable-blink-features=AutomationControlled",
      "--load-extension=" + extDir,
    ],
    ignoreDefaultArgs: ["--enable-automation"],
    enableExtensions: true,
  });

  const page = (await browser.pages())[0] || await browser.newPage();
  
  // Main frame injection
  await page.evaluateOnNewDocument(bypassJs);

  // ★ Use CDP to auto-attach to ALL new targets (including cross-origin iframes)
  const cdp = await page.createCDPSession();
  
  // Enable Target domain at browser level
  const browserCdp = await page.createCDPSession();
  
  // Use Page.setInterceptFileChooserDialog to ensure we can access frames
  await cdp.send("Page.enable");
  
  // ★ Key: use Target.setAutoAttach on the browser-level CDP session
  // First, get a browser-level CDP session
  const browserWsEndpoint = browser.wsEndpoint();
  const browserSession = await page.createCDPSession();
  
  // Try Runtime.evaluate on each frame via page.frames()
  // But first, let's use a different approach: inject via frame targets
  
  // Monitor for new frames and inject
  page.on("frameattached", async (frame) => {
    const url = frame.url();
    console.log("[frameattached]", url.substring(0, 80));
    try {
      await frame.evaluate(bypassJs);
      console.log("  -> bypass injected into frame!");
    } catch(e) {
      console.log("  -> inject failed:", e.message.substring(0, 50));
    }
  });

  page.on("framenavigated", async (frame) => {
    const url = frame.url();
    if (frame === page.mainFrame()) return;
    console.log("[framenavigated]", url.substring(0, 80));
    try {
      await frame.evaluate(bypassJs);
      console.log("  -> bypass injected into frame!");
    } catch(e) {
      console.log("  -> inject failed:", e.message.substring(0, 50));
    }
  });

  // Navigate to local Turnstile test page
  const testPagePath = "file:///" + join(__dirname, "turnstile_test.html").replace(/\\/g, "/");
  console.log("Navigating to: " + testPagePath);
  await page.goto(testPagePath, { waitUntil: "networkidle2", timeout: 30000 });
  await new Promise(r => setTimeout(r, 5000));

  // List all frames
  const frames = page.frames();
  console.log("\n=== All frames (" + frames.length + ") ===");
  for (let i = 0; i < frames.length; i++) {
    const f = frames[i];
    const url = f.url();
    let check = "ACCESS DENIED";
    try {
      check = JSON.stringify(await f.evaluate(() => ({
        bypass: !!window.__CF_BYPASS__,
        webdriver: navigator.webdriver,
      })));
    } catch(e) {}
    console.log("  [" + i + "] " + url.substring(0, 80) + " => " + check);
  }

  await page.screenshot({ path: "debug_cdp_target.png", fullPage: true });
  
  // Now try: use browser.targets() to find iframe targets
  console.log("\n=== Browser targets ===");
  const targets = browser.targets();
  for (const t of targets) {
    console.log("  type=" + t.type() + " url=" + t.url().substring(0, 80));
  }

  await browser.close();
})();
